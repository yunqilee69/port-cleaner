import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_VERSION = "0.1.0";
const EXPECTED_CSP_SOURCES = {
  "default-src": ["'self'"],
  "connect-src": ["'self'", "http://ipc.localhost", "ipc:"],
  "img-src": ["'self'", "asset:", "data:", "http://asset.localhost"],
  "style-src": ["'self'"],
  "script-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

function cargoPackageVersion(cargoSource) {
  const cargoPackage = cargoSource.match(
    /^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m,
  )?.[1];
  return cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
}

function parseCsp(csp) {
  const directives = new Map();

  for (const segment of csp.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const [name, ...sources] = tokens;
    assert.ok(!directives.has(name), `Tauri CSP repeats directive: ${name}`);
    directives.set(name, sources);
  }

  return directives;
}

export function verifyReleaseMetadata({
  packageJson,
  cargoSource,
  tauriConfig,
  capabilityConfig,
}) {
  const cargoVersion = cargoPackageVersion(cargoSource);
  assert.ok(cargoVersion, "Cargo package version is missing");
  assert.equal(packageJson.version, RELEASE_VERSION, `package.json version must be ${RELEASE_VERSION}`);
  assert.equal(cargoVersion, RELEASE_VERSION, `Cargo.toml version must be ${RELEASE_VERSION}`);
  assert.equal(tauriConfig.version, RELEASE_VERSION, `tauri.conf.json version must be ${RELEASE_VERSION}`);
  assert.equal(packageJson.version, cargoVersion, "package.json and Cargo.toml versions differ");
  assert.equal(tauriConfig.version, cargoVersion, "tauri.conf.json and Cargo.toml versions differ");
  assert.equal(tauriConfig.productName, "Port Cleaner", "unexpected Tauri productName");
  assert.equal(
    tauriConfig.identifier,
    "dev.yunqi.portcleaner",
    "unexpected Tauri identifier",
  );
  assert.equal(tauriConfig.bundle?.targets, "all", "Tauri bundle targets must be all");

  const csp = tauriConfig.app?.security?.csp;
  assert.equal(typeof csp, "string", "Tauri CSP must be a non-null string");
  assert.ok(csp.trim(), "Tauri CSP must not be empty");
  const directives = parseCsp(csp);
  for (const name of directives.keys()) {
    assert.ok(
      Object.hasOwn(EXPECTED_CSP_SOURCES, name),
      `Tauri CSP contains an unapproved directive: ${name}`,
    );
  }
  for (const [name, expectedSources] of Object.entries(EXPECTED_CSP_SOURCES)) {
    assert.ok(directives.has(name), `Tauri CSP is missing directive: ${name}`);
    assert.deepEqual(
      [...directives.get(name)].sort(),
      [...expectedSources].sort(),
      `Tauri CSP ${name} sources differ from the release allowlist`,
    );
  }

  assert.deepEqual(
    capabilityConfig.permissions,
    [],
    "default capability permissions must be exactly empty",
  );

  return { version: cargoVersion };
}

async function readReleaseMetadata() {
  const [packageSource, cargoSource, tauriSource, capabilitySource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"),
  ]);

  return {
    packageJson: JSON.parse(packageSource),
    cargoSource,
    tauriConfig: JSON.parse(tauriSource),
    capabilityConfig: JSON.parse(capabilitySource),
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const result = verifyReleaseMetadata(await readReleaseMetadata());
  console.log(`Release metadata verified for Port Cleaner ${result.version}.`);
}
