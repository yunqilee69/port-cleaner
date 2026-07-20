# Compact Binding Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone overview cards and place compact port statistics in the binding table header.

**Architecture:** Compute aggregate counts in `App` from the complete binding collection and render them beside the existing filtered result count. Remove the unused summary component and its card-specific responsive styles.

**Tech Stack:** React 19, TypeScript, Vitest, CSS

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `src/App.test.tsx`

- [ ] Assert the standalone overview heading is absent.
- [ ] Assert the table header statistics expose total, TCP, UDP, restricted, and refreshed values.
- [ ] Run `npm test -- --run src/App.test.tsx` and confirm failure before implementation.

### Task 2: Merge Statistics Into Table Header

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/components/SummaryMetrics.tsx`
- Modify: `src/App.css`

- [ ] Remove the overview section and summary component import.
- [ ] Memoize TCP, UDP, and restricted aggregate counts.
- [ ] Render compact statistics in the existing console heading.
- [ ] Replace card styles with wrapping compact-stat styles.
- [ ] Run the focused component tests.

### Task 3: Verify The Project

**Files:**
- Verify all modified files

- [ ] Run `npm run check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `git diff --check`.
