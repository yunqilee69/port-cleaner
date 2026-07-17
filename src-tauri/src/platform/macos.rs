use crate::domain::{BindingState, PortBinding, ProcessDetails, Protocol};
use crate::error::AppError;
use crate::platform::{
    access_for, binding_id, command_failure_message, listening_bindings, parse_error,
    parse_local_endpoint, parse_optional_pid, parse_protocol, parse_ps_output, run_unix_command,
    run_unix_command_output, trusted_executable, CommandOutput,
};
use crate::process_service::{
    ProcessIdentity, ProcessReader, ProcessTerminator, ReaderFuture, TerminatorFuture,
};

pub struct SystemProcessReader;
pub struct SystemProcessTerminator;

impl ProcessReader for SystemProcessReader {
    fn list_bindings(&self) -> ReaderFuture<'_, Vec<PortBinding>> {
        Box::pin(async {
            let executable = trusted_executable("lsof", &lsof_candidates())?;
            let output =
                run_unix_command(executable, &["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP"]).await?;
            Ok(listening_bindings(parse_lsof_output(&output)?))
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
        Box::pin(async move { process_identity(pid) })
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

fn lsof_candidates() -> [&'static std::path::Path; 1] {
    [std::path::Path::new("/usr/sbin/lsof")]
}

fn ps_candidates() -> [&'static std::path::Path; 1] {
    [std::path::Path::new("/bin/ps")]
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

fn identity_from_start_time(seconds: u64, microseconds: u64) -> ProcessIdentity {
    ProcessIdentity::new(format!("macos:{seconds}:{microseconds}"))
}

#[cfg(target_os = "macos")]
fn identity_from_bsd_info(info: &ProcBsdInfo) -> ProcessIdentity {
    identity_from_start_time(info.pbi_start_tvsec, info.pbi_start_tvusec)
}

#[cfg(target_os = "macos")]
fn process_identity(pid: u32) -> Result<ProcessIdentity, AppError> {
    use std::ffi::c_void;

    const PROC_PIDTBSDINFO: i32 = 3;
    let pid = i32::try_from(pid).map_err(|_| AppError::NotFound(pid))?;
    let mut info: ProcBsdInfo = unsafe { std::mem::zeroed() };
    let expected_size = std::mem::size_of::<ProcBsdInfo>() as i32;
    let returned = unsafe {
        proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            std::ptr::addr_of_mut!(info).cast::<c_void>(),
            expected_size,
        )
    };

    if returned == expected_size {
        return Ok(identity_from_bsd_info(&info));
    }
    if returned <= 0 {
        let error = std::io::Error::last_os_error();
        return Err(match error.raw_os_error() {
            Some(3) => AppError::NotFound(pid as u32),
            Some(1 | 13) => AppError::Restricted,
            _ => AppError::CommandFailed(format!("proc_pidinfo failed for process {pid}: {error}")),
        });
    }

    Err(AppError::Parse(format!(
        "proc_pidinfo returned {returned} bytes, expected {expected_size}"
    )))
}

#[cfg(not(target_os = "macos"))]
fn process_identity(_pid: u32) -> Result<ProcessIdentity, AppError> {
    Err(AppError::UnsupportedPlatform)
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct ProcBsdInfo {
    _pbi_flags: u32,
    _pbi_status: u32,
    _pbi_xstatus: u32,
    _pbi_pid: u32,
    _pbi_ppid: u32,
    _pbi_uid: u32,
    _pbi_gid: u32,
    _pbi_ruid: u32,
    _pbi_rgid: u32,
    _pbi_svuid: u32,
    _pbi_svgid: u32,
    _rfu_1: u32,
    _pbi_comm: [i8; 16],
    _pbi_name: [i8; 32],
    _pbi_nfiles: u32,
    _pbi_pgid: u32,
    _pbi_pjobc: u32,
    _e_tdev: u32,
    _e_tpgid: u32,
    _pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
extern "C" {
    fn proc_pidinfo(
        pid: i32,
        flavor: i32,
        arg: u64,
        buffer: *mut std::ffi::c_void,
        buffer_size: i32,
    ) -> i32;
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

pub fn parse_lsof_output(input: &str) -> Result<Vec<PortBinding>, AppError> {
    input
        .lines()
        .filter(|line| !line.trim().is_empty() && !is_header(line))
        .try_fold(Vec::new(), |mut bindings, line| {
            if let Some(binding) = parse_lsof_row(line)? {
                bindings.push(binding);
            }
            Ok(bindings)
        })
}

fn is_header(line: &str) -> bool {
    let mut columns = line.split_whitespace();
    matches!(columns.next(), Some("COMMAND")) && matches!(columns.next(), Some("PID"))
}

fn parse_lsof_row(line: &str) -> Result<Option<PortBinding>, AppError> {
    let columns: Vec<_> = line.split_whitespace().collect();
    if columns.len() < 8 {
        return Err(parse_error("lsof row", line));
    }

    let (pid, user_index) = if columns[1]
        .chars()
        .all(|character| character.is_ascii_digit())
    {
        (parse_optional_pid(columns[1], "lsof pid")?, 2)
    } else {
        (None, 1)
    };
    let protocol_index = columns
        .iter()
        .enumerate()
        .skip(user_index + 5)
        .find_map(|(index, value)| matches!(*value, "TCP" | "UDP").then_some(index))
        .ok_or_else(|| parse_error("lsof protocol", line))?;
    if protocol_index + 1 >= columns.len() {
        return Err(parse_error("lsof name", line));
    }

    let protocol = parse_protocol(columns[protocol_index], "lsof protocol")?;
    let name = columns[protocol_index + 1..].join(" ");
    let connection = name
        .split_whitespace()
        .next()
        .ok_or_else(|| parse_error("lsof name", line))?;
    let local_endpoint = connection
        .split_once("->")
        .map_or(connection, |(local, _)| local);
    let state = parse_state(&protocol, &name, connection, line)?;
    if local_endpoint == "*:*" {
        return Ok(None);
    }
    let (local_address, port) = parse_local_endpoint(local_endpoint, "lsof local endpoint")?;
    let access = access_for(pid);

    Ok(Some(PortBinding {
        id: binding_id(&protocol, &local_address, port, pid),
        protocol,
        local_address,
        port,
        state,
        pid,
        process_name: Some(columns[0].to_owned()),
        user_name: Some(columns[user_index].to_owned()),
        access,
    }))
}

fn parse_state(
    protocol: &Protocol,
    name: &str,
    connection: &str,
    line: &str,
) -> Result<BindingState, AppError> {
    let state = name[connection.len()..].trim();
    match protocol {
        Protocol::Udp if state.is_empty() => Ok(BindingState::Unknown),
        Protocol::Udp => Err(parse_error("lsof UDP state", line)),
        Protocol::Tcp if state.is_empty() => Ok(BindingState::Connected),
        Protocol::Tcp => match state {
            "(LISTEN)" => Ok(BindingState::Listening),
            "(ESTABLISHED)" => Ok(BindingState::Connected),
            "(SYN_SENT)" | "(SYN_RCVD)" | "(FIN_WAIT_1)" | "(FIN_WAIT_2)" | "(CLOSE_WAIT)"
            | "(CLOSING)" | "(LAST_ACK)" | "(TIME_WAIT)" | "(CLOSED)" => Ok(BindingState::Unknown),
            _ => Err(parse_error("lsof TCP state", line)),
        },
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        identity_from_start_time, lsof_candidates, map_termination_error, parse_ps_details_output,
        ps_candidates, ps_details_args, termination_command,
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
        assert_eq!(lsof_candidates(), [Path::new("/usr/sbin/lsof")]);
        assert_eq!(ps_candidates(), [Path::new("/bin/ps")]);
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
    fn macos_identity_preserves_microsecond_start_precision() {
        let first = identity_from_start_time(1_700_000_000, 123_456);
        let second = identity_from_start_time(1_700_000_000, 123_457);

        assert_eq!(
            first,
            crate::process_service::ProcessIdentity::new("macos:1700000000:123456")
        );
        assert_ne!(first, second);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn proc_bsd_info_layout_and_start_fields_match_identity() {
        use super::{identity_from_bsd_info, ProcBsdInfo};

        assert_eq!(std::mem::size_of::<ProcBsdInfo>(), 136);
        let mut info: ProcBsdInfo = unsafe { std::mem::zeroed() };
        info.pbi_start_tvsec = 1_700_000_000;
        info.pbi_start_tvusec = 654_321;

        assert_eq!(
            identity_from_bsd_info(&info),
            crate::process_service::ProcessIdentity::new("macos:1700000000:654321")
        );
    }

    #[test]
    fn maps_kill_permission_denied_to_restricted() {
        let error = AppError::CommandFailed("kill: 4242: Operation not permitted".to_owned());

        assert!(matches!(
            map_termination_error(4242, error),
            AppError::Restricted
        ));
    }

    #[test]
    fn maps_identifiable_missing_pid_to_not_found() {
        let error = AppError::CommandFailed("kill: 4242: No such process".to_owned());

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
}
