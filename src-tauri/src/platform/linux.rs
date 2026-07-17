use crate::domain::{BindingState, PortBinding, ProcessDetails, Protocol};
use crate::error::AppError;
use crate::platform::{
    access_for, binding_id, command_failure_message, parse_error, parse_local_endpoint,
    parse_optional_pid, parse_protocol, parse_ps_output, run_unix_command, run_unix_command_output,
    trusted_executable, validate_peer_endpoint, CommandOutput,
};
use crate::process_service::{
    ProcessIdentity, ProcessReader, ProcessTerminator, ReaderFuture, TerminatorFuture,
};

pub struct SystemProcessReader;
pub struct SystemProcessTerminator;

impl ProcessReader for SystemProcessReader {
    fn list_bindings(&self) -> ReaderFuture<'_, Vec<PortBinding>> {
        Box::pin(async {
            let executable = trusted_executable("ss", &ss_candidates())?;
            let output = run_unix_command(executable, &["-H", "-ltnup"]).await?;
            parse_ss_output(&output)
        })
    }

    fn process_details(&self, pid: u32) -> ReaderFuture<'_, ProcessDetails> {
        Box::pin(async move {
            let executable = trusted_executable("ps", &ps_candidates())?;
            let args = ps_details_args(pid);
            let output =
                run_unix_command_output(&executable, &[&args[0], &args[1], &args[2], &args[3]])
                    .await?;
            parse_ps_details_output(pid, output)
        })
    }

    fn process_identity(&self, pid: u32) -> ReaderFuture<'_, ProcessIdentity> {
        Box::pin(async move { read_proc_stat_identity(pid).await })
    }
}

impl ProcessTerminator for SystemProcessTerminator {
    fn terminate(&self, pid: u32) -> TerminatorFuture<'_> {
        Box::pin(async move {
            let (executable, args) = termination_command(pid);
            run_unix_command(executable, &[&args[0], &args[1]])
                .await
                .map_err(|error| map_termination_error(pid, error))?;
            Ok(())
        })
    }
}

fn ss_candidates() -> [&'static std::path::Path; 2] {
    [
        std::path::Path::new("/usr/bin/ss"),
        std::path::Path::new("/bin/ss"),
    ]
}

fn ps_candidates() -> [&'static std::path::Path; 2] {
    [
        std::path::Path::new("/bin/ps"),
        std::path::Path::new("/usr/bin/ps"),
    ]
}

fn ps_details_args(pid: u32) -> [String; 4] {
    [
        "-p".to_owned(),
        pid.to_string(),
        "-o".to_owned(),
        "pid=,user=,comm=,args=".to_owned(),
    ]
}

fn parse_ps_details_output(pid: u32, output: CommandOutput) -> Result<ProcessDetails, AppError> {
    if output.success {
        return parse_ps_output(pid, &output.stdout);
    }
    if output.status_code == Some(1) {
        return Err(AppError::NotFound(pid));
    }

    Err(AppError::CommandFailed(command_failure_message(
        std::ffi::OsStr::new("ps"),
        &output,
    )))
}

async fn read_proc_stat_identity(pid: u32) -> Result<ProcessIdentity, AppError> {
    let path = format!("/proc/{pid}/stat");
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(pid),
            std::io::ErrorKind::PermissionDenied => AppError::Restricted,
            _ => AppError::CommandFailed(format!("failed to read {path}: {error}")),
        })?;
    parse_proc_stat_identity_bytes(pid, &bytes)
}

fn parse_proc_stat_identity_bytes(pid: u32, input: &[u8]) -> Result<ProcessIdentity, AppError> {
    let comm_start = input
        .iter()
        .position(|byte| *byte == b'(')
        .ok_or_else(|| proc_stat_parse_error("comm", input))?;
    let pid_bytes = trim_ascii_whitespace(&input[..comm_start]);
    let parsed_pid = std::str::from_utf8(pid_bytes)
        .map_err(|_| proc_stat_parse_error("pid", input))?
        .parse::<u32>()
        .map_err(|_| proc_stat_parse_error("pid", input))?;
    if parsed_pid != pid {
        return Err(proc_stat_parse_error("pid", input));
    }

    let comm_end = input
        .windows(2)
        .rposition(|window| window == b") ")
        .ok_or_else(|| proc_stat_parse_error("comm", input))?;
    if comm_end <= comm_start {
        return Err(proc_stat_parse_error("comm", input));
    }

    let mut fields = input[comm_end + 2..]
        .split(|byte| byte.is_ascii_whitespace())
        .filter(|field| !field.is_empty());
    let state = fields
        .next()
        .ok_or_else(|| proc_stat_parse_error("state", input))?;
    if state.len() != 1 || !state[0].is_ascii() {
        return Err(proc_stat_parse_error("state", input));
    }
    let starttime_bytes = fields
        .nth(18)
        .ok_or_else(|| proc_stat_parse_error("starttime", input))?;
    let starttime = std::str::from_utf8(starttime_bytes)
        .map_err(|_| proc_stat_parse_error("starttime", input))?
        .parse::<u64>()
        .map_err(|_| proc_stat_parse_error("starttime", input))?;

    Ok(ProcessIdentity::new(format!("linux:{starttime}")))
}

fn trim_ascii_whitespace(mut value: &[u8]) -> &[u8] {
    while value.first().is_some_and(u8::is_ascii_whitespace) {
        value = &value[1..];
    }
    while value.last().is_some_and(u8::is_ascii_whitespace) {
        value = &value[..value.len() - 1];
    }
    value
}

fn proc_stat_parse_error(source: &str, input: &[u8]) -> AppError {
    AppError::Parse(format!(
        "invalid /proc stat {source} data: {}",
        String::from_utf8_lossy(input)
    ))
}

fn termination_command(pid: u32) -> (&'static str, [String; 2]) {
    ("/bin/kill", ["-TERM".to_owned(), pid.to_string()])
}

fn map_termination_error(pid: u32, error: AppError) -> AppError {
    let message = error.to_string();
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("permission denied") || normalized.contains("operation not permitted") {
        AppError::Restricted
    } else if normalized.contains("no such process") || normalized.contains("process not found") {
        AppError::NotFound(pid)
    } else {
        AppError::TerminationFailed(message)
    }
}

pub fn parse_ss_output(input: &str) -> Result<Vec<PortBinding>, AppError> {
    input
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_ss_row)
        .collect()
}

fn parse_ss_row(line: &str) -> Result<PortBinding, AppError> {
    let columns: Vec<_> = line.split_whitespace().collect();
    if columns.len() < 6 {
        return Err(parse_error("ss row", line));
    }

    let protocol = parse_protocol(columns[0], "ss protocol")?;
    let state = parse_state(&protocol, columns[1], line)?;
    parse_queue(columns[2], line)?;
    parse_queue(columns[3], line)?;
    let (local_address, port) = parse_local_endpoint(columns[4], "ss local endpoint")?;
    validate_peer_endpoint(columns[5], "ss peer endpoint")?;

    let details = columns[6..].join(" ");
    if !details.is_empty() && (!details.starts_with("users:(") || !details.ends_with(')')) {
        return Err(parse_error("ss details", line));
    }
    let pid = parse_pid(&details, line)?;
    let access = access_for(pid);

    Ok(PortBinding {
        id: binding_id(&protocol, &local_address, port, pid),
        protocol,
        local_address,
        port,
        state,
        pid,
        process_name: parse_process_name(&details),
        user_name: None,
        access,
    })
}

fn parse_state(protocol: &Protocol, value: &str, line: &str) -> Result<BindingState, AppError> {
    match (protocol, value) {
        (Protocol::Tcp, "LISTEN") => Ok(BindingState::Listening),
        (Protocol::Tcp, "ESTAB") => Ok(BindingState::Connected),
        (Protocol::Tcp, "SYN-SENT" | "SYN-RECV" | "FIN-WAIT-1" | "FIN-WAIT-2")
        | (Protocol::Tcp, "TIME-WAIT" | "CLOSE" | "CLOSE-WAIT" | "LAST-ACK" | "CLOSING") => {
            Ok(BindingState::Unknown)
        }
        (Protocol::Udp, "UNCONN") => Ok(BindingState::Unknown),
        (Protocol::Udp, "ESTAB") => Ok(BindingState::Connected),
        _ => Err(parse_error("ss state", line)),
    }
}

fn parse_queue(value: &str, line: &str) -> Result<(), AppError> {
    value
        .parse::<u32>()
        .map(|_| ())
        .map_err(|_| parse_error("ss queue", line))
}

fn parse_pid(details: &str, line: &str) -> Result<Option<u32>, AppError> {
    let Some(pid_start) = details.find("pid=") else {
        return Ok(None);
    };
    let digits: String = details[pid_start + 4..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return Err(parse_error("ss pid", line));
    }

    parse_optional_pid(&digits, "ss pid")
}

fn parse_process_name(details: &str) -> Option<String> {
    let name_start = details.find("((\"")? + 3;
    let name_end = details[name_start..].find("\",pid=")? + name_start;
    Some(details[name_start..name_end].to_owned())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        map_termination_error, parse_proc_stat_identity_bytes, parse_ps_details_output,
        ps_candidates, ps_details_args, ss_candidates, termination_command,
    };
    use crate::error::AppError;
    use crate::platform::CommandOutput;

    #[test]
    fn termination_command_uses_trusted_kill_with_graceful_arguments() {
        let (executable, args) = termination_command(4242);

        assert_eq!(executable, "/bin/kill");
        assert_eq!(args, ["-TERM", "4242"]);
    }

    #[test]
    fn authorization_commands_use_only_fixed_absolute_candidates() {
        assert_eq!(
            ss_candidates(),
            [Path::new("/usr/bin/ss"), Path::new("/bin/ss")]
        );
        assert_eq!(
            ps_candidates(),
            [Path::new("/bin/ps"), Path::new("/usr/bin/ps")]
        );
    }

    #[test]
    fn ps_command_is_used_only_for_process_details() {
        assert_eq!(
            ps_details_args(4242),
            ["-p", "4242", "-o", "pid=,user=,comm=,args="]
        );
    }

    #[test]
    fn ps_details_exit_one_is_not_found_without_reading_english_stderr() {
        let output = CommandOutput::from_parts(false, Some(1), "", "プロセスがありません");

        assert!(matches!(
            parse_ps_details_output(4242, output),
            Err(AppError::NotFound(4242))
        ));
    }

    #[test]
    fn parses_proc_stat_starttime_after_comm_with_spaces_and_parentheses() {
        let input = proc_stat(4242, "worker (pool) name)", 987_654);

        assert_eq!(
            parse_proc_stat_identity_bytes(4242, input.as_bytes()).unwrap(),
            crate::process_service::ProcessIdentity::new("linux:987654")
        );
    }

    #[test]
    fn parses_proc_stat_with_invalid_utf8_inside_comm() {
        let mut input = b"4242 (worker ".to_vec();
        input.extend_from_slice(&[0xff, 0xfe]);
        input.extend_from_slice(b" name) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654");

        assert_eq!(
            parse_proc_stat_identity_bytes(4242, &input).unwrap(),
            crate::process_service::ProcessIdentity::new("linux:987654")
        );
    }

    #[test]
    fn same_pid_with_different_starttime_ticks_has_different_identity() {
        let first_input = proc_stat(4242, "node", 100);
        let second_input = proc_stat(4242, "node", 101);
        let first = parse_proc_stat_identity_bytes(4242, first_input.as_bytes()).unwrap();
        let second = parse_proc_stat_identity_bytes(4242, second_input.as_bytes()).unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn malformed_proc_stat_is_parse_error() {
        assert!(matches!(
            parse_proc_stat_identity_bytes(4242, b"4242 (unterminated S 1 2 3"),
            Err(AppError::Parse(_))
        ));
    }

    #[test]
    fn maps_kill_permission_denied_to_restricted() {
        let error = AppError::CommandFailed("kill: (4242) - Operation not permitted".to_owned());

        assert!(matches!(
            map_termination_error(4242, error),
            AppError::Restricted
        ));
    }

    #[test]
    fn maps_identifiable_missing_pid_to_not_found() {
        let error = AppError::CommandFailed("kill: (4242) - No such process".to_owned());

        assert!(matches!(
            map_termination_error(4242, error),
            AppError::NotFound(4242)
        ));
    }

    #[test]
    fn maps_other_kill_errors_to_termination_failed() {
        let error = AppError::CommandFailed("kill failed unexpectedly".to_owned());

        assert!(matches!(
            map_termination_error(4242, error),
            AppError::TerminationFailed(message) if message.contains("kill failed unexpectedly")
        ));
    }

    fn proc_stat(pid: u32, comm: &str, starttime: u64) -> String {
        format!("{pid} ({comm}) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 {starttime}")
    }
}
