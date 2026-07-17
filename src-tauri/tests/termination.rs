use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use port_cleaner_lib::domain::{
    Access, BindingState, PortBinding, ProcessDetails, Protocol, TerminateRequest,
    TerminationResult,
};
use port_cleaner_lib::error::AppError;
use port_cleaner_lib::process_service::{
    ProcessIdentity, ProcessReader, ProcessService, ProcessTerminator, ReaderFuture,
    TerminatorFuture,
};

#[derive(Clone)]
struct FakeReader {
    events: Arc<Mutex<Vec<String>>>,
    bindings: Result<Vec<PortBinding>, AppError>,
    details: Result<ProcessDetails, AppError>,
    identities: Arc<Mutex<VecDeque<Result<ProcessIdentity, AppError>>>>,
}

impl ProcessReader for FakeReader {
    fn process_identity(&self, pid: u32) -> ReaderFuture<'_, ProcessIdentity> {
        self.events
            .lock()
            .unwrap()
            .push(format!("process_identity:{pid}"));
        let events = Arc::clone(&self.events);
        let result = self.identities.lock().unwrap().pop_front().unwrap();
        Box::pin(async move {
            events
                .lock()
                .unwrap()
                .push(format!("process_identity_complete:{pid}"));
            result
        })
    }

    fn list_bindings(&self) -> ReaderFuture<'_, Vec<PortBinding>> {
        self.events.lock().unwrap().push("list_bindings".to_owned());
        let result = self.bindings.clone();
        Box::pin(async move { result })
    }

    fn process_details(&self, pid: u32) -> ReaderFuture<'_, ProcessDetails> {
        self.events
            .lock()
            .unwrap()
            .push(format!("process_details:{pid}"));
        let events = Arc::clone(&self.events);
        let result = self.details.clone();
        Box::pin(async move {
            events
                .lock()
                .unwrap()
                .push(format!("process_details_complete:{pid}"));
            result
        })
    }
}

#[derive(Clone)]
struct FakeTerminator {
    events: Arc<Mutex<Vec<String>>>,
    result: Result<(), AppError>,
}

impl ProcessTerminator for FakeTerminator {
    fn terminate(&self, pid: u32) -> TerminatorFuture<'_> {
        self.events.lock().unwrap().push(format!("terminate:{pid}"));
        let result = self.result.clone();
        Box::pin(async move { result })
    }
}

fn request() -> TerminateRequest {
    TerminateRequest {
        pid: 4242,
        protocol: Protocol::Tcp,
        local_address: "::1".to_owned(),
        port: 3000,
    }
}

fn binding() -> PortBinding {
    PortBinding {
        id: "tcp:[::1]:3000:4242".to_owned(),
        protocol: Protocol::Tcp,
        local_address: "[0:0:0:0:0:0:0:1]".to_owned(),
        port: 3000,
        state: BindingState::Listening,
        pid: Some(4242),
        process_name: Some("node".to_owned()),
        user_name: Some("alice".to_owned()),
        access: Access::Allowed,
    }
}

fn details(pid: u32, access: Access) -> ProcessDetails {
    ProcessDetails {
        pid,
        name: "node".to_owned(),
        executable_path: Some("/usr/local/bin/node".to_owned()),
        user_name: Some("alice".to_owned()),
        command_line: Some("node server.js".to_owned()),
        access,
    }
}

fn service(
    bindings: Result<Vec<PortBinding>, AppError>,
    details: Result<ProcessDetails, AppError>,
    termination: Result<(), AppError>,
) -> (
    ProcessService<FakeReader, FakeTerminator>,
    Arc<Mutex<Vec<String>>>,
) {
    service_with_identities(
        bindings,
        details,
        termination,
        vec![
            Ok(ProcessIdentity::new("started-once")),
            Ok(ProcessIdentity::new("started-once")),
        ],
    )
}

fn service_with_identities(
    bindings: Result<Vec<PortBinding>, AppError>,
    details: Result<ProcessDetails, AppError>,
    termination: Result<(), AppError>,
    identities: Vec<Result<ProcessIdentity, AppError>>,
) -> (
    ProcessService<FakeReader, FakeTerminator>,
    Arc<Mutex<Vec<String>>>,
) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let reader = FakeReader {
        events: Arc::clone(&events),
        bindings,
        details,
        identities: Arc::new(Mutex::new(identities.into())),
    };
    let terminator = FakeTerminator {
        events: Arc::clone(&events),
        result: termination,
    };

    (ProcessService::with_terminator(reader, terminator), events)
}

#[test]
fn terminate_request_serializes_with_camel_case_fields() {
    let value = serde_json::to_value(request()).unwrap();

    assert_eq!(value["pid"], 4242);
    assert_eq!(value["protocol"], "tcp");
    assert_eq!(value["localAddress"], "::1");
    assert_eq!(value["port"], 3000);
}

#[tokio::test]
async fn refuses_zero_pid_without_reading_or_terminating() {
    let (service, events) = service(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
    );
    let mut request = request();
    request.pid = 0;

    assert!(matches!(
        service.terminate_process(request).await,
        Err(AppError::NotFound(0))
    ));
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_details_pid_mismatch_without_revalidation_or_termination() {
    let (service, events) = service(
        Ok(vec![binding()]),
        Ok(details(7777, Access::Allowed)),
        Ok(()),
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::BindingChanged)
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
        ]
    );
}

#[tokio::test]
async fn refuses_restricted_processes_without_revalidation_or_termination() {
    let (service, events) = service(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Restricted)),
        Ok(()),
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::Restricted)
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
        ]
    );
}

#[tokio::test]
async fn refuses_changed_binding_without_terminating() {
    let mut changed = binding();
    changed.port = 3001;
    let (service, events) = service(
        Ok(vec![changed]),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::BindingChanged)
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
            "list_bindings",
        ]
    );
}

#[tokio::test]
async fn propagates_binding_reader_failure_without_terminating() {
    let (service, events) = service(
        Err(AppError::CommandFailed("reader failed".to_owned())),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::CommandFailed(message)) if message == "reader failed"
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
            "list_bindings",
        ]
    );
}

#[tokio::test]
async fn terminates_immediately_after_completed_identity_details_and_revalidation() {
    let (service, events) = service(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
    );

    assert_eq!(
        service.terminate_process(request()).await.unwrap(),
        TerminationResult {
            pid: 4242,
            terminated: true,
        }
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
            "list_bindings",
            "process_identity:4242",
            "process_identity_complete:4242",
            "terminate:4242",
        ]
    );
}

#[tokio::test]
async fn refuses_reused_pid_when_process_identity_changes() {
    let (service, events) = service_with_identities(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
        vec![
            Ok(ProcessIdentity::new("first-process")),
            Ok(ProcessIdentity::new("reused-pid")),
        ],
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::BindingChanged)
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
            "list_bindings",
            "process_identity:4242",
            "process_identity_complete:4242",
        ]
    );
}

#[tokio::test]
async fn reports_not_found_when_process_disappears_during_revalidation() {
    let (service, events) = service_with_identities(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Allowed)),
        Ok(()),
        vec![
            Ok(ProcessIdentity::new("first-process")),
            Err(AppError::NotFound(4242)),
        ],
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::NotFound(4242))
    ));
    assert!(!events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event.starts_with("terminate:")));
}

#[tokio::test]
async fn propagates_terminator_error_after_revalidation() {
    let (service, events) = service(
        Ok(vec![binding()]),
        Ok(details(4242, Access::Allowed)),
        Err(AppError::TerminationFailed("signal failed".to_owned())),
    );

    assert!(matches!(
        service.terminate_process(request()).await,
        Err(AppError::TerminationFailed(message)) if message == "signal failed"
    ));
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "process_identity:4242",
            "process_identity_complete:4242",
            "process_details:4242",
            "process_details_complete:4242",
            "list_bindings",
            "process_identity:4242",
            "process_identity_complete:4242",
            "terminate:4242",
        ]
    );
}
