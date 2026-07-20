import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("resets native select appearance and styles a custom chevron", async () => {
  const css = await readFile(new URL("../src/App.css", import.meta.url), "utf8");

  assert.match(css, /\.select-field select\s*\{[^}]*appearance:\s*none;/s);
  assert.match(css, /\.select-field select\s*\{[^}]*-webkit-appearance:\s*none;/s);
  assert.match(css, /\.select-chevron\s*\{[^}]*pointer-events:\s*none;/s);
});
