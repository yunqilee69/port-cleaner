use crate::domain::{PortBinding, ProcessDetails, TerminateRequest, TerminationResult};
use crate::process_service::ProcessService;

#[tauri::command]
pub async fn list_port_bindings() -> Result<Vec<PortBinding>, String> {
    ProcessService::system()
        .list_port_bindings()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_process_details(pid: u32) -> Result<ProcessDetails, String> {
    ProcessService::system()
        .get_process_details(pid)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn terminate_process(request: TerminateRequest) -> Result<TerminationResult, String> {
    ProcessService::system()
        .terminate_process(request)
        .await
        .map_err(|error| error.to_string())
}
