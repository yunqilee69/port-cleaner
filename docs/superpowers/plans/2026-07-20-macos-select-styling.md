# macOS Select Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make protocol and access selects visually consistent with the other filter inputs on macOS.

**Architecture:** Preserve native `select` behavior while removing the platform-rendered control chrome through CSS appearance reset. Render a decorative chevron inside a select-specific label so all platforms share the same visible indicator.

**Tech Stack:** React 19, CSS, Vitest, Node test runner

---

### Task 1: Add Failing Regression Tests

**Files:**
- Modify: `src/App.test.tsx`
- Create: `scripts/ui-style.test.mjs`
- Modify: `package.json`

- [ ] Assert both combobox labels use `select-field--select`.
- [ ] Assert both combobox labels contain a decorative chevron.
- [ ] Assert CSS resets standard and WebKit select appearance.
- [ ] Add the style test to `npm run check`.
- [ ] Run focused tests and confirm they fail before implementation.

### Task 2: Implement Consistent Select Styling

**Files:**
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/App.css`

- [ ] Add the select-specific label class and decorative chevron nodes.
- [ ] Reset native select appearance.
- [ ] Position and style the chevron without intercepting pointer input.
- [ ] Run focused tests and confirm they pass.

### Task 3: Verify The Project

**Files:**
- Verify all modified files

- [ ] Run `npm run check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `git diff --check`.
