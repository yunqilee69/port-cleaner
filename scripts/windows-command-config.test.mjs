import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runs Windows system commands without creating console windows", async () => {
  const platformSource = await readFile(
    new URL("../src-tauri/src/platform/mod.rs", import.meta.url),
    "utf8",
  );

  assert.match(
    platformSource,
    /#\[cfg\(target_os = "windows"\)\]\s*use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;/,
  );
  assert.match(
    platformSource,
    /#\[cfg\(target_os = "windows"\)\]\s*command\.creation_flags\(CREATE_NO_WINDOW\);/,
  );
});
