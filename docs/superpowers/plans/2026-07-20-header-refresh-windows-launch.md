# Header Refresh And Windows Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the header refresh experience, widen the default window, and prevent release Windows builds from opening a console window.

**Architecture:** Keep refresh state in `App` and expose it only through `ConsoleHeader`. Configure desktop launch behavior at the Tauri entry point and window size in Tauri configuration. Protect both behaviors with focused regression tests.

**Tech Stack:** React 19, Vitest, Tauri 2, Rust, Node test runner

---

### Task 1: Header And Refresh Regression Tests

**Files:**
- Modify: `src/App.test.tsx`

- [ ] Assert the header renders `Port Cleaner` without the removed explanatory labels.
- [ ] Change the refresh progress test to expect the top button to show `扫描中…` and be disabled.
- [ ] Assert the content-area refresh banner is absent while the request is active.
- [ ] Run `npm test -- --run src/App.test.tsx` and confirm the new assertions fail before implementation.

### Task 2: Simplify Header And Refresh UI

**Files:**
- Modify: `src/components/ConsoleHeader.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] Remove the brand kicker and system status markup.
- [ ] Remove the content-area refresh banner while retaining success notifications.
- [ ] Remove unused refresh/status CSS and responsive overrides.
- [ ] Run `npm test -- --run src/App.test.tsx` and confirm the focused tests pass.

### Task 3: Windows Launch And Window Width Tests

**Files:**
- Create: `scripts/desktop-config.test.mjs`
- Modify: `package.json`

- [ ] Assert `src-tauri/src/main.rs` contains the release-only Windows subsystem attribute.
- [ ] Assert the configured default window width is at least `1000`.
- [ ] Add the desktop configuration test to the project check scripts.
- [ ] Run `node --test scripts/desktop-config.test.mjs` and confirm it fails before implementation.

### Task 4: Windows Launch And Window Width Implementation

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] Add `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` to the Tauri binary entry point.
- [ ] Change `app.windows[0].width` from `800` to `1000`.
- [ ] Run `node --test scripts/desktop-config.test.mjs` and confirm it passes.

### Task 5: Full Verification

**Files:**
- Verify all modified files

- [ ] Run `npm run check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Review `git diff --check` and `git status --short`.
