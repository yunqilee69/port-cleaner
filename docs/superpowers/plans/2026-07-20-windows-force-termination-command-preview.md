# Windows Force Termination Command Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force-terminate Windows process trees and show the exact platform command in the confirmation dialog.

**Architecture:** Keep termination validation in `ProcessService`, changing only the final Windows command arguments. Generate presentation-only command text in a small frontend helper so Windows and Unix dialogs remain accurate without adding another IPC request.

**Tech Stack:** Rust, Tokio, React 19, TypeScript, Vitest

---

### Task 1: Add Failing Backend And UI Tests

**Files:**
- Modify: `src-tauri/src/platform/windows.rs`
- Create: `src/utils/termination.test.ts`
- Modify: `src/App.test.tsx`

- [ ] Change the Windows command test to require `/F`.
- [ ] Test Windows and Unix command presentation values.
- [ ] Test the Windows confirmation dialog command and warning.
- [ ] Run focused Rust and frontend tests and confirm failure before implementation.

### Task 2: Implement Force Termination And Presentation

**Files:**
- Modify: `src-tauri/src/platform/windows.rs`
- Create: `src/utils/termination.ts`
- Modify: `src/components/TerminateDialog.tsx`
- Modify: `src/components/BindingTable.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] Add `/F` to the Windows taskkill arguments and execution call.
- [ ] Add platform-specific termination presentation helper.
- [ ] Display the command in the confirmation facts.
- [ ] Show forceful Windows warning, note, button, and success text.
- [ ] Remove inaccurate generic “normal termination” tooltip text.
- [ ] Run focused tests and confirm they pass.

### Task 3: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/validation/port-cleaner-manual-checklist.md`

- [ ] Document Windows `/T /F` behavior and data-loss risk.
- [ ] Update manual Windows termination expectations.

### Task 4: Verify And Commit

**Files:**
- Verify all modified files

- [ ] Run `npm run check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `git diff --check`.
- [ ] Commit the verified changes.
