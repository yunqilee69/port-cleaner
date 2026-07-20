# Windows Hidden Child Processes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows system commands launched by Port Cleaner from creating visible console windows.

**Architecture:** Apply the Windows `CREATE_NO_WINDOW` flag once in the shared command runner so scanning, details, and termination inherit the same behavior. Keep the implementation behind a Windows cfg guard so Unix builds remain unchanged.

**Tech Stack:** Rust, Tokio process API, windows-sys, Node test runner

---

### Task 1: Add Failing Regression Check

**Files:**
- Create: `scripts/windows-command-config.test.mjs`
- Modify: `package.json`

- [ ] Assert the shared command runner imports `CREATE_NO_WINDOW` under a Windows cfg.
- [ ] Assert the command applies `creation_flags(CREATE_NO_WINDOW)` before execution.
- [ ] Add the regression check to `npm run check`.
- [ ] Run the focused test and confirm failure before implementation.

### Task 2: Hide Windows Command Windows

**Files:**
- Modify: `src-tauri/src/platform/mod.rs`

- [ ] Import `CREATE_NO_WINDOW` only on Windows.
- [ ] Apply the creation flag to the shared Tokio command.
- [ ] Run the focused regression test.
- [ ] Run Rust formatting and tests.

### Task 3: Verify And Commit

**Files:**
- Verify all modified files

- [ ] Run `npm run check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `git diff --check`.
- [ ] Commit the verified fix.
