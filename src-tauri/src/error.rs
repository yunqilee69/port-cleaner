use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, Error, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppError {
    #[error("unsupported platform")]
    UnsupportedPlatform,
    #[error("command failed: {0}")]
    CommandFailed(String),
    #[error("failed to parse platform output: {0}")]
    Parse(String),
    #[error("process {0} was not found")]
    NotFound(u32),
    #[error("access is restricted")]
    Restricted,
    #[error("port binding changed before termination")]
    BindingChanged,
    #[error("process termination failed: {0}")]
    TerminationFailed(String),
}
