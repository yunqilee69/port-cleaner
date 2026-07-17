use port_cleaner_lib::domain::{Access, BindingState, PortBinding, Protocol};
use port_cleaner_lib::error::AppError;
use port_cleaner_lib::platform::{linux, macos, windows};

#[test]
fn parses_linux_tcp_listener_with_pid_and_name() {
    let input = include_str!("fixtures/linux-ss.txt");
    let bindings = linux::parse_ss_output(input).unwrap();

    assert_eq!(bindings.len(), 2);
    assert_eq!(bindings[0].protocol, Protocol::Tcp);
    assert_eq!(bindings[0].port, 3000);
    assert_eq!(bindings[0].state, BindingState::Listening);
    assert_eq!(bindings[0].pid, Some(4242));
    assert_eq!(bindings[0].process_name.as_deref(), Some("node"));
}

#[test]
fn parses_macos_lsof_rows_with_a_header_and_restricted_udp_socket() {
    let input = include_str!("fixtures/macos-lsof.txt");
    let bindings = macos::parse_lsof_output(input).unwrap();
    let tcp = bindings
        .iter()
        .find(|binding| binding.protocol == Protocol::Tcp)
        .unwrap();
    let udp = bindings
        .iter()
        .find(|binding| binding.protocol == Protocol::Udp)
        .unwrap();

    assert_eq!(bindings.len(), 2);
    assert_eq!(tcp.process_name.as_deref(), Some("node"));
    assert_eq!(tcp.pid, Some(4242));
    assert_eq!(tcp.user_name.as_deref(), Some("alice"));
    assert_eq!(tcp.local_address, "127.0.0.1");
    assert_eq!(tcp.port, 3000);
    assert_eq!(tcp.state, BindingState::Listening);
    assert_eq!(udp.port, 5353);
    assert_eq!(udp.access.as_str(), "restricted");
    assert!(!bindings
        .iter()
        .any(|binding| binding.process_name.as_deref() == Some("kernel_task")));
}

#[test]
fn parses_windows_listening_tcp_row() {
    let input = include_str!("fixtures/windows-netstat.txt");
    let bindings = windows::parse_netstat_output(input).unwrap();

    assert_eq!(bindings[0].local_address, "0.0.0.0");
    assert_eq!(bindings[0].port, 8080);
    assert_eq!(bindings[0].pid, Some(9124));
}

#[test]
fn parsed_bindings_have_deterministic_ids() {
    let linux_bindings = linux::parse_ss_output(include_str!("fixtures/linux-ss.txt")).unwrap();
    let macos_bindings = macos::parse_lsof_output(include_str!("fixtures/macos-lsof.txt")).unwrap();
    let windows_bindings =
        windows::parse_netstat_output(include_str!("fixtures/windows-netstat.txt")).unwrap();

    assert_eq!(linux_bindings[0].id, "tcp:127.0.0.1:3000:4242");
    assert_eq!(macos_bindings[1].id, "udp:*:5353:none");
    assert_eq!(windows_bindings[0].id, "tcp:0.0.0.0:8080:9124");
}

#[test]
fn parsers_ignore_blank_rows() {
    let linux_bindings = linux::parse_ss_output("\n\n  \n").unwrap();
    let macos_bindings = macos::parse_lsof_output("\n\t\n").unwrap();
    let windows_bindings = windows::parse_netstat_output("\n \n").unwrap();

    assert!(linux_bindings.is_empty());
    assert!(macos_bindings.is_empty());
    assert!(windows_bindings.is_empty());
}

#[test]
fn parsers_reject_malformed_nonempty_rows() {
    let linux_result =
        linux::parse_ss_output("tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* malformed-details");
    let macos_result = macos::parse_lsof_output(
        "node 4242 alice 20u IPv4 0x0000 0t0 TCP 127.0.0.1:3000 (INVALID)",
    );
    let windows_result = windows::parse_netstat_output(
        "TCP 0.0.0.0:8080 0.0.0.0:0 LISTENING 9124 unexpected-column",
    );

    assert!(matches!(linux_result, Err(AppError::Parse(_))));
    assert!(matches!(macos_result, Err(AppError::Parse(_))));
    assert!(matches!(windows_result, Err(AppError::Parse(_))));
}

#[test]
fn windows_returns_parse_for_a_short_nonempty_row() {
    let result = windows::parse_netstat_output("TCP");

    assert!(matches!(result, Err(AppError::Parse(_))));
}

#[test]
fn linux_rejects_invalid_states_queues_and_endpoints() {
    let invalid_protocol = linux::parse_ss_output("sctp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*");
    let invalid_state = linux::parse_ss_output("tcp INVALID 0 511 127.0.0.1:3000 0.0.0.0:*");
    let invalid_queue =
        linux::parse_ss_output("tcp LISTEN not-a-number 511 127.0.0.1:3000 0.0.0.0:*");
    let invalid_second_queue =
        linux::parse_ss_output("tcp LISTEN 0 not-a-number 127.0.0.1:3000 0.0.0.0:*");
    let invalid_local = linux::parse_ss_output("tcp LISTEN 0 511 127.0.0.1:* 0.0.0.0:*");
    let invalid_peer = linux::parse_ss_output("tcp LISTEN 0 511 127.0.0.1:3000 malformed-peer");

    assert!(matches!(invalid_protocol, Err(AppError::Parse(_))));
    assert!(matches!(invalid_state, Err(AppError::Parse(_))));
    assert!(matches!(invalid_queue, Err(AppError::Parse(_))));
    assert!(matches!(invalid_second_queue, Err(AppError::Parse(_))));
    assert!(matches!(invalid_local, Err(AppError::Parse(_))));
    assert!(matches!(invalid_peer, Err(AppError::Parse(_))));
}

#[test]
fn windows_rejects_invalid_endpoints_and_unknown_tcp_states() {
    let invalid_local =
        windows::parse_netstat_output("TCP 0.0.0.0:not-a-port 0.0.0.0:0 LISTENING 9124");
    let invalid_foreign =
        windows::parse_netstat_output("TCP 0.0.0.0:8080 malformed-peer LISTENING 9124");
    let invalid_state =
        windows::parse_netstat_output("TCP 0.0.0.0:8080 0.0.0.0:0 MADE_UP_STATE 9124");
    let invalid_pid =
        windows::parse_netstat_output("TCP 0.0.0.0:8080 0.0.0.0:0 LISTENING not-a-pid");

    assert!(matches!(invalid_local, Err(AppError::Parse(_))));
    assert!(matches!(invalid_foreign, Err(AppError::Parse(_))));
    assert!(matches!(invalid_state, Err(AppError::Parse(_))));
    assert!(matches!(invalid_pid, Err(AppError::Parse(_))));
}

#[test]
fn windows_maps_documented_nonterminal_tcp_states_to_unknown() {
    let bindings =
        windows::parse_netstat_output("TCP 127.0.0.1:3000 127.0.0.1:45678 TIME_WAIT 9124").unwrap();

    assert_eq!(bindings[0].state, BindingState::Unknown);
}

#[test]
fn serializes_port_binding_with_camel_case_fields_and_lowercase_enums() {
    let binding = PortBinding {
        id: "tcp:127.0.0.1:3000:4242".to_owned(),
        protocol: Protocol::Tcp,
        local_address: "127.0.0.1".to_owned(),
        port: 3000,
        state: BindingState::Listening,
        pid: Some(4242),
        process_name: Some("node".to_owned()),
        user_name: Some("alice".to_owned()),
        access: Access::Allowed,
    };

    let value = serde_json::to_value(binding).unwrap();

    assert_eq!(value["localAddress"], "127.0.0.1");
    assert_eq!(value["processName"], "node");
    assert_eq!(value["userName"], "alice");
    assert_eq!(value["protocol"], "tcp");
    assert_eq!(value["state"], "listening");
    assert_eq!(value["access"], "allowed");
}
