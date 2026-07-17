use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use port_cleaner_lib::domain::{Access, BindingState, PortBinding, ProcessDetails, Protocol};
use port_cleaner_lib::error::AppError;
use port_cleaner_lib::process_service::{ProcessIdentity, ProcessReader, ProcessService};

#[derive(Clone)]
struct FakeReader {
    calls: Arc<Mutex<Vec<String>>>,
    bindings: Vec<PortBinding>,
    details: ProcessDetails,
}

impl ProcessReader for FakeReader {
    fn list_bindings(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<PortBinding>, AppError>> + Send + '_>> {
        self.calls.lock().unwrap().push("list_bindings".to_owned());
        let bindings = self.bindings.clone();
        Box::pin(async move { Ok(bindings) })
    }

    fn process_details(
        &self,
        pid: u32,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessDetails, AppError>> + Send + '_>> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("process_details:{pid}"));
        let details = self.details.clone();
        Box::pin(async move { Ok(details) })
    }

    fn process_identity(
        &self,
        pid: u32,
    ) -> Pin<Box<dyn Future<Output = Result<ProcessIdentity, AppError>> + Send + '_>> {
        Box::pin(async move { Ok(ProcessIdentity::new(format!("identity:{pid}"))) })
    }
}

fn binding() -> PortBinding {
    PortBinding {
        id: "tcp:127.0.0.1:3000:4242".to_owned(),
        protocol: Protocol::Tcp,
        local_address: "127.0.0.1".to_owned(),
        port: 3000,
        state: BindingState::Listening,
        pid: Some(4242),
        process_name: Some("node".to_owned()),
        user_name: Some("alice".to_owned()),
        access: Access::Allowed,
    }
}

fn details() -> ProcessDetails {
    ProcessDetails {
        pid: 4242,
        name: "node".to_owned(),
        executable_path: Some("/usr/local/bin/node".to_owned()),
        user_name: Some("alice".to_owned()),
        command_line: Some("node server.js".to_owned()),
        access: Access::Allowed,
    }
}

#[tokio::test]
async fn service_delegates_to_its_reader() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let reader = FakeReader {
        calls: Arc::clone(&calls),
        bindings: vec![binding()],
        details: details(),
    };
    let service = ProcessService::new(reader);

    assert_eq!(service.list_port_bindings().await.unwrap(), vec![binding()]);
    assert_eq!(service.get_process_details(4242).await.unwrap(), details());
    assert_eq!(
        *calls.lock().unwrap(),
        vec!["list_bindings", "process_details:4242"]
    );
}

#[tokio::test]
async fn zero_pid_returns_not_found_without_calling_the_reader() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let reader = FakeReader {
        calls: Arc::clone(&calls),
        bindings: vec![],
        details: details(),
    };
    let service = ProcessService::new(reader);

    assert!(matches!(
        service.get_process_details(0).await,
        Err(AppError::NotFound(0))
    ));
    assert!(calls.lock().unwrap().is_empty());
}
