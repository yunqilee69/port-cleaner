use std::path::PathBuf;

use crate::domain::{Access, BindingState, PortBinding, ProcessDetails, Protocol};
use crate::error::AppError;
use crate::platform::{
    access_for, binding_id, command_failure_message, parse_error, parse_local_endpoint,
    parse_optional_pid, parse_protocol, run_command, run_command_output, validate_peer_endpoint,
    CommandOutput,
};
use crate::process_service::{
    ProcessIdentity, ProcessReader, ProcessTerminator, ReaderFuture, TerminatorFuture,
};

pub struct SystemProcessReader;
pub struct SystemProcessTerminator;

impl ProcessReader for SystemProcessReader {
    fn list_bindings(&self) -> ReaderFuture<'_, Vec<PortBinding>> {
        Box::pin(async {
            let system_directory = system_directory()?;
            let executable = system_executable_from_directory(system_directory, "netstat.exe");
            let tcp = run_command(&executable, &["-ano", "-p", "tcp"]).await?;
            let udp = run_command(&executable, &["-ano", "-p", "udp"]).await?;
            let output = [tcp, udp]
                .into_iter()
                .flat_map(|output| output.lines().map(str::to_owned).collect::<Vec<_>>())
                .filter(|line| matches!(line.split_whitespace().next(), Some("TCP") | Some("UDP")))
                .collect::<Vec<_>>()
                .join("\n");
            parse_netstat_output(&output)
        })
    }

    fn process_details(&self, pid: u32) -> ReaderFuture<'_, ProcessDetails> {
        Box::pin(async move {
            let executable = system_executable("tasklist.exe")?;
            let filter = format!("PID eq {pid}");
            let output = run_command(executable, &["/fo", "csv", "/nh", "/fi", &filter]).await?;
            parse_tasklist_output(pid, &output)
        })
    }

    fn process_identity(&self, pid: u32) -> ReaderFuture<'_, ProcessIdentity> {
        Box::pin(async move { process_identity(pid) })
    }
}

impl ProcessTerminator for SystemProcessTerminator {
    fn terminate(&self, pid: u32) -> TerminatorFuture<'_> {
        Box::pin(async move {
            let system_directory = system_directory()?;
            let (executable, args) = termination_command(system_directory, pid);
            let output =
                run_command_output(&executable, &[&args[0], &args[1], &args[2]], &[]).await?;
            if !output.success {
                return Err(map_termination_output(output));
            }
            Ok(())
        })
    }
}

fn termination_command(system_directory: PathBuf, pid: u32) -> (PathBuf, [String; 3]) {
    (
        system_executable_from_directory(system_directory, "taskkill.exe"),
        ["/PID".to_owned(), pid.to_string(), "/T".to_owned()],
    )
}

fn map_termination_output(output: CommandOutput) -> AppError {
    if output.status_code == Some(5) {
        return AppError::Restricted;
    }

    let message = command_failure_message(std::ffi::OsStr::new("taskkill.exe"), &output);
    let normalized = output.stderr.to_ascii_lowercase();
    if normalized.contains("access is denied")
        || normalized.contains("access denied")
        || normalized.contains("permission denied")
    {
        AppError::Restricted
    } else {
        AppError::TerminationFailed(message)
    }
}

fn system_executable(name: &str) -> Result<PathBuf, AppError> {
    Ok(system_executable_from_directory(system_directory()?, name))
}

fn system_executable_from_directory(system_directory: PathBuf, name: &str) -> PathBuf {
    system_directory.join(name)
}

#[cfg(target_os = "windows")]
fn system_directory() -> Result<PathBuf, AppError> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = vec![0_u16; 260];
    loop {
        let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 {
            let error = unsafe { GetLastError() };
            return Err(AppError::CommandFailed(format!(
                "GetSystemDirectoryW failed with Windows error {error}"
            )));
        }
        if (length as usize) < buffer.len() {
            buffer.truncate(length as usize);
            return Ok(PathBuf::from(OsString::from_wide(&buffer)));
        }
        buffer.resize(length as usize, 0);
    }
}

#[cfg(not(target_os = "windows"))]
fn system_directory() -> Result<PathBuf, AppError> {
    Err(AppError::UnsupportedPlatform)
}

#[cfg(target_os = "windows")]
fn process_identity(pid: u32) -> Result<ProcessIdentity, AppError> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, FILETIME};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == 0 {
        return Err(map_process_api_error(pid, unsafe { GetLastError() }));
    }

    let mut creation: FILETIME = unsafe { std::mem::zeroed() };
    let mut exit: FILETIME = unsafe { std::mem::zeroed() };
    let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
    let mut user: FILETIME = unsafe { std::mem::zeroed() };
    let succeeded =
        unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 };
    let error = (!succeeded).then(|| unsafe { GetLastError() });
    unsafe {
        CloseHandle(handle);
    }

    if let Some(error) = error {
        return Err(map_process_api_error(pid, error));
    }

    let identity = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    Ok(ProcessIdentity::new(identity.to_string()))
}

#[cfg(any(target_os = "windows", test))]
fn map_process_api_error(pid: u32, error: u32) -> AppError {
    match error {
        5 => AppError::Restricted,
        87 => AppError::NotFound(pid),
        _ => AppError::CommandFailed(format!(
            "process identity query failed with Windows error {error}"
        )),
    }
}

#[cfg(not(target_os = "windows"))]
fn process_identity(_pid: u32) -> Result<ProcessIdentity, AppError> {
    Err(AppError::UnsupportedPlatform)
}

fn parse_tasklist_output(requested_pid: u32, input: &str) -> Result<ProcessDetails, AppError> {
    let row = input
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or(AppError::NotFound(requested_pid))?;
    if row.starts_with("INFO:") {
        return Err(AppError::NotFound(requested_pid));
    }
    let fields = parse_csv_row(row)?;
    if fields.len() < 2 {
        return Err(parse_error("tasklist row", row));
    }
    let pid = fields[1]
        .parse()
        .map_err(|_| parse_error("tasklist pid", row))?;
    if pid != requested_pid {
        return Err(AppError::NotFound(requested_pid));
    }

    Ok(ProcessDetails {
        pid,
        name: fields[0].to_owned(),
        executable_path: None,
        user_name: None,
        command_line: None,
        access: Access::Allowed,
    })
}

fn parse_csv_row(row: &str) -> Result<Vec<String>, AppError> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = row.chars().peekable();

    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && matches!(characters.peek(), Some('"')) => {
                field.push('"');
                characters.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => {
                fields.push(std::mem::take(&mut field));
            }
            _ => field.push(character),
        }
    }
    if quoted {
        return Err(parse_error("tasklist CSV", row));
    }
    fields.push(field);
    Ok(fields)
}

pub fn parse_netstat_output(input: &str) -> Result<Vec<PortBinding>, AppError> {
    input
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_netstat_row)
        .collect()
}

fn parse_netstat_row(line: &str) -> Result<PortBinding, AppError> {
    let columns: Vec<_> = line.split_whitespace().collect();
    if columns.len() < 2 {
        return Err(parse_error("netstat row", line));
    }

    let protocol = parse_protocol(columns[0], "netstat protocol")?;
    let (local_address, port) = parse_local_endpoint(columns[1], "netstat local endpoint")?;
    let (state, pid_column) = match protocol {
        Protocol::Tcp => {
            if columns.len() != 5 {
                return Err(parse_error("netstat TCP row", line));
            }
            validate_peer_endpoint(columns[2], "netstat foreign endpoint")?;
            (parse_state(columns[3], line)?, columns[4])
        }
        Protocol::Udp => {
            if columns.len() != 4 {
                return Err(parse_error("netstat UDP row", line));
            }
            validate_peer_endpoint(columns[2], "netstat foreign endpoint")?;
            (BindingState::Unknown, columns[3])
        }
    };
    let pid = parse_optional_pid(pid_column, "netstat pid")?;
    let access = access_for(pid);

    Ok(PortBinding {
        id: binding_id(&protocol, &local_address, port, pid),
        protocol,
        local_address,
        port,
        state,
        pid,
        process_name: None,
        user_name: None,
        access,
    })
}

fn parse_state(value: &str, line: &str) -> Result<BindingState, AppError> {
    match value {
        "LISTENING" => Ok(BindingState::Listening),
        "ESTABLISHED" => Ok(BindingState::Connected),
        "CLOSED" | "CLOSE_WAIT" | "CLOSING" | "DELETE_TCB" | "FIN_WAIT_1" | "FIN_WAIT_2"
        | "LAST_ACK" | "SYN_RECEIVED" | "SYN_SENT" | "TIME_WAIT" => Ok(BindingState::Unknown),
        _ => Err(parse_error("netstat TCP state", line)),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        map_process_api_error, map_termination_output, parse_tasklist_output,
        system_executable_from_directory, termination_command,
    };
    use crate::domain::Access;
    use crate::error::AppError;
    use crate::platform::CommandOutput;

    #[test]
    fn tasklist_found_details_allow_termination() {
        let details =
            parse_tasklist_output(4242, r#""node.exe","4242","Console","1","12,345 K""#).unwrap();

        assert_eq!(details.access, Access::Allowed);
    }

    #[test]
    fn termination_command_uses_system32_taskkill_without_force() {
        let (executable, args) = termination_command(PathBuf::from(r"C:\Windows\System32"), 4242);

        assert_eq!(
            executable,
            PathBuf::from(r"C:\Windows\System32").join("taskkill.exe")
        );
        assert_eq!(args, ["/PID", "4242", "/T"]);
        assert!(!args.iter().any(|argument| argument == "/F"));
    }

    #[test]
    fn system_executable_is_absolute_under_native_system_directory() {
        assert_eq!(
            system_executable_from_directory(PathBuf::from(r"C:\Windows\System32"), "netstat.exe"),
            PathBuf::from(r"C:\Windows\System32").join("netstat.exe")
        );
    }

    #[test]
    fn maps_taskkill_access_denied_to_restricted() {
        let output = CommandOutput::from_parts(false, Some(5), "", "zugriff verweigert");

        assert!(matches!(
            map_termination_output(output),
            AppError::Restricted
        ));
    }

    #[test]
    fn maps_native_process_errors_without_localized_text() {
        assert!(matches!(
            map_process_api_error(4242, 5),
            AppError::Restricted
        ));
        assert!(matches!(
            map_process_api_error(4242, 87),
            AppError::NotFound(4242)
        ));
    }

    #[test]
    fn maps_other_taskkill_errors_to_termination_failed() {
        let output = CommandOutput::from_parts(false, Some(9), "", "taskkill failed unexpectedly");

        assert!(matches!(
            map_termination_output(output),
            AppError::TerminationFailed(message) if message.contains("taskkill failed unexpectedly")
        ));
    }
}
