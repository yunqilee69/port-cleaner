# Port Cleaner MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri desktop utility that lists local TCP/UDP port bindings, reveals process details, and safely terminates a selected process.

**Architecture:** The Rust Tauri layer owns the stable DTOs, OS command execution, parsers, authorization-aware termination, and command boundary. The React layer consumes only typed `invoke` wrappers and renders a searchable binding table with an explicit termination confirmation. Parsers are pure functions backed by fixture tests so Linux, macOS, and Windows behavior remains deterministic.

**Tech Stack:** Tauri 2, Rust, serde, thiserror, tokio process APIs, React, TypeScript, Vite, Vitest, Testing Library.

---

## File Structure

- `src-tauri/src/domain.rs` — serializable binding, process, access, and termination DTOs.
- `src-tauri/src/error.rs` — application error variants translated to command-safe strings.
- `src-tauri/src/platform/mod.rs` — platform selection plus parser module exports.
- `src-tauri/src/platform/{linux,macos,windows}.rs` — pure OS command-output parsers and readers.
- `src-tauri/src/process_service.rs` — orchestration for list/detail/termination workflows.
- `src-tauri/src/commands.rs` — the three Tauri command entry points.
- `src-tauri/tests/` — fixture-based parser, service, and command-contract tests.
- `src/api/portCleaner.ts` — typed frontend facade over `@tauri-apps/api/core`.
- `src/types/portCleaner.ts` — TypeScript equivalents of the Rust DTOs.
- `src/components/` — binding list, detail panel, and termination confirmation UI.
- `src/App.tsx` — application composition and UI state.
- `README.md` — local prerequisites, supported platforms, and safe-termination behavior.

There is no Git repository in this workspace. Do not run `git init`, `git add`, `git commit`, or any other commit command.

### Task 1: Scaffold the Tauri application and command boundary

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/domain.rs`
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/platform/mod.rs`
- Create: `src-tauri/src/process_service.rs`

- [ ] **Step 1: Create the application using the official Tauri React template**

```bash
npm create tauri-app@latest . -- --template react-ts --manager npm
npm install
```

Expected: the repository contains `src/`, `src-tauri/`, a React entry point, and `npm run tauri` starts a desktop development window.

- [ ] **Step 2: Register the stable command boundary**

Write `src-tauri/src/lib.rs`:

```rust
mod commands;
mod domain;
mod error;
mod platform;
mod process_service;

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
```

Write `src-tauri/src/main.rs`:

```rust
fn main() {
    port_cleaner_lib::run();
}
```

Create the remaining declared modules as empty, compilable placeholders. The three command functions may return an explicit `not implemented` error until Task 4 defines their final contracts.

- [ ] **Step 3: Add only the Rust dependencies required by the first vertical slice**

Ensure `src-tauri/Cargo.toml` has:

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
thiserror = "2"
tokio = { version = "1", features = ["process", "rt", "macros"] }
```

- [ ] **Step 4: Verify the empty shell compiles**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run tauri build -- --debug
```

Expected: Rust formatting succeeds and a debug `.app`/`.dmg` bundle is created under `src-tauri/target/debug/bundle/`.

### Task 2: Define stable Rust models and parser contracts test-first

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/domain.rs`
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/platform/mod.rs`
- Create: `src-tauri/src/platform/linux.rs`
- Create: `src-tauri/src/platform/macos.rs`
- Create: `src-tauri/src/platform/windows.rs`
- Create: `src-tauri/tests/platform_parsing.rs`
- Create: `src-tauri/tests/fixtures/linux-ss.txt`
- Create: `src-tauri/tests/fixtures/macos-lsof.txt`
- Create: `src-tauri/tests/fixtures/windows-netstat.txt`

- [ ] **Step 1: Write fixture-based failing parser tests**

Write `src-tauri/tests/platform_parsing.rs`:

```rust
use port_cleaner_lib::domain::{BindingState, Protocol};
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
fn parses_macos_udp_socket_without_a_pid_as_restricted() {
    let input = include_str!("fixtures/macos-lsof.txt");
    let bindings = macos::parse_lsof_output(input).unwrap();
    let udp = bindings.iter().find(|binding| binding.protocol == Protocol::Udp).unwrap();
    assert_eq!(udp.port, 5353);
    assert_eq!(udp.access.as_str(), "restricted");
}

#[test]
fn parses_windows_listening_tcp_row() {
    let input = include_str!("fixtures/windows-netstat.txt");
    let bindings = windows::parse_netstat_output(input).unwrap();
    assert_eq!(bindings[0].local_address, "0.0.0.0");
    assert_eq!(bindings[0].port, 8080);
    assert_eq!(bindings[0].pid, Some(9124));
}
```

Use these fixtures:

```text
# linux-ss.txt
tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=4242,fd=20))
udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:*
```

```text
# macos-lsof.txt
node	4242	alice	20u	IPv4	0x0000	0t0	TCP	127.0.0.1:3000 (LISTEN)
mdnsresponder		root	15u	IPv4	0x0000	0t0	UDP	*:5353
```

```text
# windows-netstat.txt
  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       9124
  UDP    0.0.0.0:5353           *:*                                    748
```

- [ ] **Step 2: Verify the test fails before implementation**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test platform_parsing
```

Expected: FAIL with unresolved imports for `domain` and platform parser modules.

- [ ] **Step 3: Define shared DTOs and errors**

Write `src-tauri/src/domain.rs` with these public contracts:

```rust
pub enum Protocol { Tcp, Udp }
pub enum BindingState { Listening, Connected, Unknown }
pub enum Access { Allowed, Restricted }
pub struct PortBinding {
    pub id: String,
    pub protocol: Protocol,
    pub local_address: String,
    pub port: u16,
    pub state: BindingState,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub user_name: Option<String>,
    pub access: Access,
}
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub executable_path: Option<String>,
    pub user_name: Option<String>,
    pub command_line: Option<String>,
    pub access: Access,
}
pub struct TerminationResult {
    pub pid: u32,
    pub terminated: bool,
}
```

Derive `Clone`, `Debug`, `Deserialize`, `Eq` where valid, `PartialEq` where valid, and `Serialize`. Apply `#[serde(rename_all = "lowercase")]` to enums and `#[serde(rename_all = "camelCase")]` to structs. Implement `Access::as_str()` returning exactly `"allowed"` or `"restricted"`.

Write `src-tauri/src/error.rs` with `thiserror::Error` variants `UnsupportedPlatform`, `CommandFailed(String)`, `Parse(String)`, `NotFound(u32)`, `Restricted`, and `TerminationFailed(String)`.

- [ ] **Step 4: Implement only the pure parsers needed by the fixtures**

Export `pub mod linux;`, `pub mod macos;`, and `pub mod windows;` from `src-tauri/src/platform/mod.rs`. Each parser returns `Result<Vec<PortBinding>, AppError>`. A missing PID must produce `Access::Restricted`; rows with a PID must produce `Access::Allowed`. IDs must be deterministic: `"{protocol}:{local_address}:{port}:{pid-or-none}"`.

- [ ] **Step 5: Verify parser contracts**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test platform_parsing
```

Expected: PASS with 3 tests.

### Task 3: Add OS readers and process-detail retrieval

**Files:**
- Modify: `src-tauri/src/platform/mod.rs`
- Modify: `src-tauri/src/platform/linux.rs`
- Modify: `src-tauri/src/platform/macos.rs`
- Modify: `src-tauri/src/platform/windows.rs`
- Modify: `src-tauri/src/process_service.rs`
- Create: `src-tauri/tests/process_service.rs`

- [ ] **Step 1: Write failing service tests using a fake reader**

Create a `PortReader` trait with `list_bindings()` and `process_details(pid)`. In `src-tauri/tests/process_service.rs`, verify a fake reader returns the supplied bindings and details, and verify `get_process_details(0)` returns `AppError::NotFound(0)` without invoking the OS reader.

```rust
#[test]
fn rejects_zero_pid_before_platform_lookup() {
    let error = ProcessService::new(FakeReader::default()).get_process_details(0).unwrap_err();
    assert!(matches!(error, AppError::NotFound(0)));
}
```

- [ ] **Step 2: Verify service tests fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test process_service
```

Expected: FAIL because `PortReader` and `ProcessService` do not exist.

- [ ] **Step 3: Implement reader selection and OS command readers**

Use `cfg(target_os)` selection in `platform::system_reader()`:

- Linux lists bindings with `ss -H -ltnup` and retrieves a process with `ps -p <pid> -o pid=,user=,comm=,args=`.
- macOS lists bindings with `lsof -nP -iTCP -sTCP:LISTEN -iUDP` and retrieves a process with `ps -p <pid> -o pid=,user=,comm=,args=`.
- Windows lists bindings with `netstat -ano -p tcp` plus `netstat -ano -p udp`, then retrieves a process with `tasklist /fo csv /nh /fi "PID eq <pid>"`.

Do not invoke a shell. Use `tokio::process::Command`, pass each executable argument separately, require a successful exit status, and convert stderr losslessly into `AppError::CommandFailed`.

- [ ] **Step 4: Implement service orchestration**

`ProcessService::list_port_bindings()` delegates to the selected reader. `ProcessService::get_process_details(pid)` rejects `pid == 0`, otherwise delegates to the selected reader. A platform command that cannot expose an owner must return an `Access::Restricted` DTO rather than inventing a PID.

- [ ] **Step 5: Verify reader/service behavior**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test process_service
cargo test --manifest-path src-tauri/Cargo.toml --test platform_parsing
```

Expected: both test binaries PASS.

### Task 4: Add safe process termination and finalize Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/process_service.rs`
- Modify: `src-tauri/src/platform/{linux,macos,windows}.rs`
- Create: `src-tauri/tests/termination.rs`

- [ ] **Step 1: Write failing termination tests**

Test these invariants with a fake terminator:

```rust
#[test]
fn refuses_zero_pid() {
    assert!(matches!(service.terminate_process(0).unwrap_err(), AppError::NotFound(0)));
}

#[test]
fn refuses_restricted_processes() {
    fake.access = Access::Restricted;
    assert!(matches!(service.terminate_process(4242).unwrap_err(), AppError::Restricted));
}

#[test]
fn terminates_allowed_process() {
    assert_eq!(service.terminate_process(4242).unwrap(), TerminationResult { pid: 4242, terminated: true });
}
```

- [ ] **Step 2: Verify the termination test fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test termination
```

Expected: FAIL because termination is not implemented.

- [ ] **Step 3: Implement safe termination contracts**

Set the final command signatures exactly:

```rust
#[tauri::command]
pub async fn list_port_bindings() -> Result<Vec<PortBinding>, String>;

#[tauri::command]
pub async fn get_process_details(pid: u32) -> Result<ProcessDetails, String>;

#[tauri::command]
pub async fn terminate_process(request: TerminateRequest) -> Result<TerminationResult, String>;
```

Before terminating, load details for the PID and reject `pid == 0`, `Access::Restricted`, and missing processes. Revalidate the exact PID/protocol/address/port binding and the process lifetime identity immediately before signaling. Linux/macOS must use `kill -TERM <pid>`; Windows must use `taskkill /PID <pid> /T`. Do not add force-kill behavior in the MVP. Map all application errors with `to_string()` at the Tauri command boundary.

- [ ] **Step 4: Verify termination and command compilation**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test termination
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests PASS.

### Task 5: Add the typed frontend API layer

**Files:**
- Create: `src/types/portCleaner.ts`
- Create: `src/api/portCleaner.ts`
- Create: `src/api/portCleaner.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a minimal frontend test setup**

Install the test dependencies:

```bash
npm install --save-dev vitest
```

Add the script:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write failing typed-invoke tests**

Mock `@tauri-apps/api/core` and assert exact command names and payloads:

```ts
expect(invoke).toHaveBeenCalledWith("get_process_details", { pid: 4242 });
expect(invoke).toHaveBeenCalledWith("terminate_process", {
  request: { pid: 4242, protocol: "tcp", localAddress: "127.0.0.1", port: 3000 },
});
expect(invoke).toHaveBeenCalledWith("list_port_bindings");
```

- [ ] **Step 3: Define frontend contracts and wrappers**

`src/types/portCleaner.ts` must export these matching contracts:

```ts
export type Protocol = "tcp" | "udp";
export type BindingState = "listening" | "connected" | "unknown";
export type Access = "allowed" | "restricted";
export interface PortBinding { id: string; protocol: Protocol; localAddress: string; port: number; state: BindingState; pid: number | null; processName: string | null; userName: string | null; access: Access; }
export interface ProcessDetails { pid: number; name: string; executablePath: string | null; userName: string | null; commandLine: string | null; access: Access; }
export interface TerminateRequest { pid: number; protocol: Protocol; localAddress: string; port: number; }
export interface TerminationResult { pid: number; terminated: boolean; }
```

`src/api/portCleaner.ts` must export `listPortBindings`, `getProcessDetails(pid)`, and `terminateProcess(request)`, each returning `Promise` of the matching DTO through `invoke`. The richer termination request is required for stale-binding and PID-reuse protection.

- [ ] **Step 4: Verify the frontend API**

Run:

```bash
npm test -- src/api/portCleaner.test.ts
npm run build
```

Expected: the API test passes and TypeScript/Vite build succeeds.

### Task 6: Build the port-cleaner UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Create: `src/components/BindingTable.tsx`
- Create: `src/components/ProcessDetailsPanel.tsx`
- Create: `src/components/TerminateDialog.tsx`
- Create: `src/components/BindingTable.test.tsx`

- [ ] **Step 1: Write the binding-table interaction test**

Render two bindings and assert that filtering by `3000` retains only the matching listener, a restricted binding shows `Restricted`, and its terminate button is disabled.

```tsx
expect(screen.getByRole("button", { name: /terminate 4242/i })).toBeEnabled();
expect(screen.getByRole("button", { name: /terminate unavailable/i })).toBeDisabled();
```

- [ ] **Step 2: Implement UI state and table**

`App.tsx` loads bindings on mount, exposes a refresh button, tracks a query string, selected PID, details load state, and a pending termination PID. `BindingTable` columns are Protocol, Address, Port, State, Process, PID, User, and Action. Sort list results by ascending port, then protocol, then local address.

- [ ] **Step 3: Implement detail and confirmation components**

Selecting an allowed row loads `getProcessDetails(pid)` and displays process name, PID, user, executable path, and command line. `TerminateDialog` must state the PID and process name, require an explicit **Terminate process** click, call `terminateProcess(pid)`, then refresh the binding list on success. It must expose a cancel button and show backend errors without discarding the current list.

- [ ] **Step 4: Verify UI behavior**

Run:

```bash
npm test -- src/components/BindingTable.test.tsx
npm run build
```

Expected: UI interaction test and production frontend build PASS.

### Task 7: Validate supported platforms and document operation

**Files:**
- Modify: `README.md`
- Modify: `src-tauri/tests/platform_parsing.rs`
- Create: `docs/validation/port-cleaner-manual-checklist.md`

- [ ] **Step 1: Extend parser fixtures for restricted and malformed rows**

Add one malformed line to each fixture and assert it is ignored rather than causing the full scan to fail. Add assertions that records without a PID are `Access::Restricted` and cannot be terminated through the service.

- [ ] **Step 2: Write the manual platform checklist**

`docs/validation/port-cleaner-manual-checklist.md` must include these exact checks:

```text
1. Start a local listener on TCP port 3000.
2. Confirm Port Cleaner displays TCP, 127.0.0.1, port 3000, PID, and process name.
3. Select the row and verify the detail panel matches the process.
4. Cancel the termination dialog and verify the listener remains reachable.
5. Confirm termination, verify the listener exits, then refresh and verify the row disappears.
6. Select a restricted row and verify no termination control is available.
```

- [ ] **Step 3: Document prerequisites and safety guarantees**

Update `README.md` with the supported commands (`ss`, `lsof`, `netstat`, `ps`, `tasklist`, `taskkill`), build instructions, and the rule that restricted/unknown owners and PID `0` are never terminated. State that the MVP uses graceful termination only and never escalates privileges.

- [ ] **Step 4: Run the release-candidate validation suite**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run build
npm run tauri build -- --debug
```

Expected: every command exits `0`; the debug app and DMG bundles are present under `src-tauri/target/debug/bundle/`.

## Plan Self-Review

- Spec coverage: Tasks 1–7 cover scaffold, Rust domain/parsers, OS readers, safe termination, typed frontend API, UI, and validation/docs in that order.
- Placeholder scan: the plan contains no unspecified implementation steps; all command names, DTO field names, parser fixtures, test assertions, and validation commands are explicit.
- Type consistency: Rust `PortBinding`, `ProcessDetails`, and `TerminationResult` serialize with camelCase names matching the TypeScript interfaces; the three Tauri command names and PID argument names are identical in Rust, tests, and frontend wrappers.
