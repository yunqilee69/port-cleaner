import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the Windows GUI subsystem for release builds", async () => {
  const mainSource = await readFile(
    new URL("../src-tauri/src/main.rs", import.meta.url),
    "utf8",
  );

  assert.match(
    mainSource,
    /^#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]$/m,
  );
});

test("opens the desktop window at a wider default width", async () => {
  const tauriConfig = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );

  assert.ok(tauriConfig.app.windows[0].width >= 1000);
});
