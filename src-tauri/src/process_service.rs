use std::future::Future;
use std::net::IpAddr;
use std::pin::Pin;

use crate::domain::{Access, PortBinding, ProcessDetails, TerminateRequest, TerminationResult};
use crate::error::AppError;

pub type ReaderFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;
pub type TerminatorFuture<'a> = Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessIdentity(String);

impl ProcessIdentity {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

pub trait ProcessReader {
    fn list_bindings(&self) -> ReaderFuture<'_, Vec<PortBinding>>;
    fn process_identity(&self, pid: u32) -> ReaderFuture<'_, ProcessIdentity>;
    fn process_details(&self, pid: u32) -> ReaderFuture<'_, ProcessDetails>;
}

pub trait ProcessTerminator {
    fn terminate(&self, pid: u32) -> TerminatorFuture<'_>;
}

pub struct ProcessService<R, T = crate::platform::SystemProcessTerminator> {
    reader: R,
    terminator: T,
}

impl<R> ProcessService<R, crate::platform::SystemProcessTerminator>
where
    R: ProcessReader,
{
    pub fn new(reader: R) -> Self {
        Self::with_terminator(reader, crate::platform::SystemProcessTerminator)
    }
}

impl<R, T> ProcessService<R, T>
where
    R: ProcessReader,
    T: ProcessTerminator,
{
    pub fn with_terminator(reader: R, terminator: T) -> Self {
        Self { reader, terminator }
    }

    pub async fn list_port_bindings(&self) -> Result<Vec<PortBinding>, AppError> {
        self.reader.list_bindings().await
    }

    pub async fn get_process_details(&self, pid: u32) -> Result<ProcessDetails, AppError> {
        if pid == 0 {
            return Err(AppError::NotFound(0));
        }

        self.reader.process_details(pid).await
    }

    /// A command-launched signal retains a small TOCTOU window after the final identity check.
    pub async fn terminate_process(
        &self,
        request: TerminateRequest,
    ) -> Result<TerminationResult, AppError> {
        if request.pid == 0 {
            return Err(AppError::NotFound(0));
        }

        let identity = self.reader.process_identity(request.pid).await?;
        let details = self.reader.process_details(request.pid).await?;
        if details.pid != request.pid {
            return Err(AppError::BindingChanged);
        }
        if details.access == Access::Restricted {
            return Err(AppError::Restricted);
        }

        let bindings = self.reader.list_bindings().await?;
        if !bindings
            .iter()
            .any(|binding| binding_matches(binding, &request))
        {
            return Err(AppError::BindingChanged);
        }

        let revalidated_identity = self.reader.process_identity(request.pid).await?;
        if revalidated_identity != identity {
            return Err(AppError::BindingChanged);
        }

        self.terminator.terminate(request.pid).await?;

        Ok(TerminationResult {
            pid: request.pid,
            terminated: true,
        })
    }
}

fn binding_matches(binding: &PortBinding, request: &TerminateRequest) -> bool {
    binding.pid == Some(request.pid)
        && binding.protocol == request.protocol
        && normalize_address(&binding.local_address) == normalize_address(&request.local_address)
        && binding.port == request.port
}

fn normalize_address(address: &str) -> String {
    let address = address.trim();
    let address = address
        .strip_prefix('[')
        .and_then(|address| address.strip_suffix(']'))
        .unwrap_or(address);

    address
        .parse::<IpAddr>()
        .map(|address| address.to_string())
        .unwrap_or_else(|_| address.to_ascii_lowercase())
}

impl
    ProcessService<crate::platform::SystemProcessReader, crate::platform::SystemProcessTerminator>
{
    pub fn system() -> Self {
        Self::new(crate::platform::SystemProcessReader)
    }
}
