use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::domain::{Access, BindingState, PortBinding, ProcessDetails, Protocol};
use crate::error::AppError;

pub mod linux;
pub mod macos;
pub mod windows;

#[cfg(target_os = "linux")]
pub use linux::{SystemProcessReader, SystemProcessTerminator};
#[cfg(target_os = "macos")]
pub use macos::{SystemProcessReader, SystemProcessTerminator};
#[cfg(target_os = "windows")]
pub use windows::{SystemProcessReader, SystemProcessTerminator};

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub struct SystemProcessReader;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub struct SystemProcessTerminator;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
impl crate::process_service::ProcessReader for SystemProcessReader {
    fn list_bindings(
        &self,
    ) -> crate::process_service::ReaderFuture<'_, Vec<crate::domain::PortBinding>> {
        Box::pin(async { Err(AppError::UnsupportedPlatform) })
    }

    fn process_details(
        &self,
        _pid: u32,
    ) -> crate::process_service::ReaderFuture<'_, ProcessDetails> {
        Box::pin(async { Err(AppError::UnsupportedPlatform) })
    }

    fn process_identity(
        &self,
        _pid: u32,
    ) -> crate::process_service::ReaderFuture<'_, crate::process_service::ProcessIdentity> {
        Box::pin(async { Err(AppError::UnsupportedPlatform) })
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
impl crate::process_service::ProcessTerminator for SystemProcessTerminator {
    fn terminate(&self, _pid: u32) -> crate::process_service::TerminatorFuture<'_> {
        Box::pin(async { Err(AppError::UnsupportedPlatform) })
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(in crate::platform) struct CommandOutput {
    pub success: bool,
    pub status_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutput {
    pub(in crate::platform) fn from_parts(
        success: bool,
        status_code: Option<i32>,
        stdout: impl Into<String>,
        stderr: impl Into<String>,
    ) -> Self {
        Self {
            success,
            status_code,
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }
}

pub(in crate::platform) async fn run_command_output(
    executable: impl AsRef<OsStr>,
    args: &[&str],
    environment: &[(&str, &str)],
) -> Result<CommandOutput, AppError> {
    let executable = executable.as_ref();
    let mut command = Command::new(executable);
    command.args(args);
    for (name, value) in environment {
        command.env(name, value);
    }
    let output = command
        .output()
        .await
        .map_err(|error| AppError::CommandFailed(error.to_string()))?;

    Ok(CommandOutput::from_parts(
        output.status.success(),
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        format_stderr(&output.stderr),
    ))
}

pub(in crate::platform) async fn run_command(
    executable: impl AsRef<OsStr>,
    args: &[&str],
) -> Result<String, AppError> {
    let executable = executable.as_ref();
    let output = run_command_output(executable, args, &[]).await?;
    require_success(executable, output)
}

pub(in crate::platform) async fn run_unix_command_output(
    executable: impl AsRef<OsStr>,
    args: &[&str],
) -> Result<CommandOutput, AppError> {
    run_command_output(executable, args, &unix_locale()).await
}

pub(in crate::platform) async fn run_unix_command(
    executable: impl AsRef<OsStr>,
    args: &[&str],
) -> Result<String, AppError> {
    let executable = executable.as_ref();
    let output = run_unix_command_output(executable, args).await?;
    require_success(executable, output)
}

pub(in crate::platform) fn require_success(
    executable: &OsStr,
    output: CommandOutput,
) -> Result<String, AppError> {
    if output.success {
        return Ok(output.stdout);
    }

    Err(AppError::CommandFailed(command_failure_message(
        executable, &output,
    )))
}

pub(in crate::platform) fn command_failure_message(
    executable: &OsStr,
    output: &CommandOutput,
) -> String {
    if !output.stderr.is_empty() {
        return output.stderr.clone();
    }

    match output.status_code {
        Some(code) => format!("{} exited with status {code}", executable.to_string_lossy()),
        None => format!(
            "{} terminated without an exit status",
            executable.to_string_lossy()
        ),
    }
}

pub(in crate::platform) fn unix_locale() -> [(&'static str, &'static str); 2] {
    [("LC_ALL", "C"), ("LANG", "C")]
}

pub(in crate::platform) fn trusted_executable(
    name: &str,
    candidates: &[&Path],
) -> Result<PathBuf, AppError> {
    select_trusted_executable_with(name, candidates, Path::exists)
}

fn select_trusted_executable_with(
    name: &str,
    candidates: &[&Path],
    exists: impl Fn(&Path) -> bool,
) -> Result<PathBuf, AppError> {
    candidates
        .iter()
        .copied()
        .find(|candidate| exists(candidate))
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            AppError::CommandFailed(format!(
                "no trusted {name} executable found in fixed allowlist"
            ))
        })
}

fn format_stderr(stderr: &[u8]) -> String {
    match std::str::from_utf8(stderr) {
        Ok(stderr) => stderr.to_owned(),
        Err(_) => format!(
            "stderr bytes (hex): {}",
            stderr
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" ")
        ),
    }
}

pub(in crate::platform) fn parse_ps_output(
    requested_pid: u32,
    input: &str,
) -> Result<ProcessDetails, AppError> {
    let row = input
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or(AppError::NotFound(requested_pid))?;
    let mut fields = row.split_whitespace();
    let pid = fields
        .next()
        .ok_or_else(|| parse_error("ps pid", row))?
        .parse()
        .map_err(|_| parse_error("ps pid", row))?;
    if pid != requested_pid {
        return Err(AppError::NotFound(requested_pid));
    }
    let user_name = fields.next().ok_or_else(|| parse_error("ps user", row))?;
    let executable = fields
        .next()
        .ok_or_else(|| parse_error("ps command", row))?;
    let command_line = fields.collect::<Vec<_>>().join(" ");
    let executable_path = executable.contains('/').then(|| executable.to_owned());
    let name = Path::new(executable)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(executable)
        .to_owned();
    let access = if user_name == "?" {
        Access::Restricted
    } else {
        Access::Allowed
    };

    Ok(ProcessDetails {
        pid,
        name,
        executable_path,
        user_name: (access == Access::Allowed).then(|| user_name.to_owned()),
        command_line: (!command_line.is_empty()).then_some(command_line),
        access,
    })
}

pub(in crate::platform) fn parse_protocol(value: &str, source: &str) -> Result<Protocol, AppError> {
    match value.to_ascii_lowercase().as_str() {
        "tcp" => Ok(Protocol::Tcp),
        "udp" => Ok(Protocol::Udp),
        _ => Err(parse_error(source, value)),
    }
}

pub(in crate::platform) fn parse_local_endpoint(
    value: &str,
    source: &str,
) -> Result<(String, u16), AppError> {
    let (address, port) = parse_endpoint_parts(value, false, source)?;
    Ok((
        address,
        port.expect("local endpoints require a numeric port"),
    ))
}

pub(in crate::platform) fn validate_peer_endpoint(
    value: &str,
    source: &str,
) -> Result<(), AppError> {
    parse_endpoint_parts(value, true, source).map(|_| ())
}

pub(in crate::platform) fn parse_optional_pid(
    value: &str,
    source: &str,
) -> Result<Option<u32>, AppError> {
    if value.is_empty() {
        return Ok(None);
    }

    value
        .parse()
        .map(Some)
        .map_err(|_| parse_error(source, value))
}

pub(in crate::platform) fn access_for(pid: Option<u32>) -> Access {
    if pid.is_some() {
        Access::Allowed
    } else {
        Access::Restricted
    }
}

pub(in crate::platform) fn binding_id(
    protocol: &Protocol,
    address: &str,
    port: u16,
    pid: Option<u32>,
) -> String {
    let protocol = match protocol {
        Protocol::Tcp => "tcp",
        Protocol::Udp => "udp",
    };
    let pid = pid.map_or_else(|| "none".to_owned(), |pid| pid.to_string());
    format!("{protocol}:{address}:{port}:{pid}")
}

pub(in crate::platform) fn listening_bindings(bindings: Vec<PortBinding>) -> Vec<PortBinding> {
    let mut seen = HashSet::new();

    bindings
        .into_iter()
        .filter_map(|mut binding| {
            if binding.protocol == Protocol::Tcp && binding.state != BindingState::Listening {
                return None;
            }
            binding.state = BindingState::Listening;
            if let Some(pid) = binding.pid {
                let protocol = match binding.protocol {
                    Protocol::Tcp => "tcp",
                    Protocol::Udp => "udp",
                };
                if !seen.insert((protocol, binding.port, pid)) {
                    return None;
                }
            }
            Some(binding)
        })
        .collect()
}

pub(in crate::platform) fn parse_error(source: &str, value: &str) -> AppError {
    AppError::Parse(format!("invalid {source} data: {value}"))
}

fn parse_endpoint_parts(
    value: &str,
    allow_wildcard_port: bool,
    source: &str,
) -> Result<(String, Option<u16>), AppError> {
    let (address, port) = value
        .rsplit_once(':')
        .ok_or_else(|| parse_error(source, value))?;
    if address.is_empty() {
        return Err(parse_error(source, value));
    }
    if allow_wildcard_port && port == "*" {
        return Ok((address.to_owned(), None));
    }

    let port = port.parse().map_err(|_| parse_error(source, value))?;
    Ok((address.to_owned(), Some(port)))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{format_stderr, select_trusted_executable_with, unix_locale};
    use crate::domain::{Access, BindingState, PortBinding, Protocol};
    use crate::error::AppError;

    #[test]
    fn preserves_valid_utf8_stderr_exactly() {
        assert_eq!(format_stderr(b"  command failed\n"), "  command failed\n");
    }

    #[test]
    fn encodes_each_invalid_utf8_stderr_byte_as_hex() {
        assert_eq!(
            format_stderr(&[0xff, 0x00, 0x20]),
            "stderr bytes (hex): ff 00 20"
        );
    }

    #[test]
    fn trusted_executable_selects_first_existing_allowlisted_candidate() {
        let candidates = [Path::new("/trusted/first"), Path::new("/trusted/second")];

        let selected = select_trusted_executable_with("tool", &candidates, |candidate| {
            candidate == Path::new("/trusted/second")
        })
        .unwrap();

        assert_eq!(selected, PathBuf::from("/trusted/second"));
    }

    #[test]
    fn trusted_executable_rejects_missing_allowlisted_candidates() {
        let candidates = [Path::new("/trusted/first"), Path::new("/trusted/second")];

        assert!(matches!(
            select_trusted_executable_with("tool", &candidates, |_| false),
            Err(AppError::CommandFailed(message)) if message.contains("trusted tool executable")
        ));
    }

    #[test]
    fn unix_commands_force_c_locale() {
        assert_eq!(unix_locale(), [("LC_ALL", "C"), ("LANG", "C")]);
    }

    #[test]
    fn keeps_only_listening_bindings_and_marks_udp_as_listening() {
        let bindings = vec![
            PortBinding {
                id: "tcp:127.0.0.1:3000:1".into(),
                protocol: Protocol::Tcp,
                local_address: "127.0.0.1".into(),
                port: 3000,
                state: BindingState::Listening,
                pid: Some(1),
                process_name: None,
                user_name: None,
                access: Access::Allowed,
            },
            PortBinding {
                id: "tcp:[::]:3000:1".into(),
                protocol: Protocol::Tcp,
                local_address: "[::]".into(),
                port: 3000,
                state: BindingState::Listening,
                pid: Some(1),
                process_name: None,
                user_name: None,
                access: Access::Allowed,
            },
            PortBinding {
                id: "tcp:127.0.0.1:3001:2".into(),
                protocol: Protocol::Tcp,
                local_address: "127.0.0.1".into(),
                port: 3001,
                state: BindingState::Connected,
                pid: Some(2),
                process_name: None,
                user_name: None,
                access: Access::Allowed,
            },
            PortBinding {
                id: "udp:0.0.0.0:5353:3".into(),
                protocol: Protocol::Udp,
                local_address: "0.0.0.0".into(),
                port: 5353,
                state: BindingState::Unknown,
                pid: Some(3),
                process_name: None,
                user_name: None,
                access: Access::Allowed,
            },
        ];

        let bindings = super::listening_bindings(bindings);

        assert_eq!(bindings.len(), 2);
        assert!(bindings
            .iter()
            .all(|binding| binding.state == BindingState::Listening));
        assert!(bindings.iter().all(|binding| binding.port != 3001));
    }

    #[test]
    fn preserves_restricted_bindings_without_a_pid_when_addresses_differ() {
        let bindings = vec![
            PortBinding {
                id: "udp:0.0.0.0:5353:none".into(),
                protocol: Protocol::Udp,
                local_address: "0.0.0.0".into(),
                port: 5353,
                state: BindingState::Unknown,
                pid: None,
                process_name: None,
                user_name: None,
                access: Access::Restricted,
            },
            PortBinding {
                id: "udp:[::]:5353:none".into(),
                protocol: Protocol::Udp,
                local_address: "[::]".into(),
                port: 5353,
                state: BindingState::Unknown,
                pid: None,
                process_name: None,
                user_name: None,
                access: Access::Restricted,
            },
        ];

        assert_eq!(super::listening_bindings(bindings).len(), 2);
    }
}
