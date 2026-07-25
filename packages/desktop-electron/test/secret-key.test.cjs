"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureEngineSecretKey } = require("../src/secret-key.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (buffer) => buffer.toString("utf8").slice("protected:".length),
  };
}

test("stores and reuses an OS-protected engine master key", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-key-"));
  const storage = fakeSafeStorage();
  const first = ensureEngineSecretKey({ safeStorage: storage, userDataPath: dataDir, environment: {} });
  const second = ensureEngineSecretKey({ safeStorage: storage, userDataPath: dataDir, environment: {} });
  assert.equal(first, second);
  assert.equal(Buffer.from(first, "base64").length, 32);
  const disk = fs.readFileSync(path.join(dataDir, "engine-secret-key.bin"), "utf8");
  assert.match(disk, /^protected:/);
});

test("accepts an explicit 32-byte environment key without touching disk", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-key-env-"));
  const supplied = crypto.randomBytes(32).toString("base64");
  const result = ensureEngineSecretKey({ safeStorage: null, userDataPath: dataDir, environment: { STARCORE_SECRET_KEY: supplied } });
  assert.equal(result, supplied);
  assert.equal(fs.readdirSync(dataDir).length, 0);
});
