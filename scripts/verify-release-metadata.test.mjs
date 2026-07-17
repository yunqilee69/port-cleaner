import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { verifyReleaseMetadata } from "./verify-release-metadata.mjs";

const [packageSource, cargoSource, tauriSource, capabilitySource] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"),
]);

const validMetadata = {
  packageJson: JSON.parse(packageSource),
  cargoSource,
  tauriConfig: JSON.parse(tauriSource),
  capabilityConfig: JSON.parse(capabilitySource),
};

test("accepts the checked-in release metadata", () => {
  assert.doesNotThrow(() => verifyReleaseMetadata(validMetadata));
});

test("rejects a synchronized but unreleased 9.9.9 version", () => {
  const metadata = structuredClone(validMetadata);
  metadata.packageJson.version = "9.9.9";
  metadata.tauriConfig.version = "9.9.9";
  metadata.cargoSource = metadata.cargoSource.replace(
    /^version = "0\.1\.0"$/m,
    'version = "9.9.9"',
  );

  assert.throws(() => verifyReleaseMetadata(metadata), /0\.1\.0/);
});

test("rejects an extra script origin", () => {
  const metadata = structuredClone(validMetadata);
  metadata.tauriConfig.app.security.csp = metadata.tauriConfig.app.security.csp.replace(
    "script-src 'self'",
    "script-src 'self' https://evil.example",
  );

  assert.throws(() => verifyReleaseMetadata(metadata), /script-src/);
});

test("rejects an unapproved CSP directive", () => {
  const metadata = structuredClone(validMetadata);
  metadata.tauriConfig.app.security.csp = `${metadata.tauriConfig.app.security.csp}; worker-src https://evil.example`;

  assert.throws(() => verifyReleaseMetadata(metadata), /worker-src/);
});

test("rejects any capability permission", () => {
  const metadata = structuredClone(validMetadata);
  metadata.capabilityConfig.permissions = ["core:default"];

  assert.throws(() => verifyReleaseMetadata(metadata), /permissions/);
});
