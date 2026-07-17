mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod process_service;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_port_bindings,
            commands::get_process_details,
            commands::terminate_process,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Port Cleaner");
}
