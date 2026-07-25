"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KEY_BYTES = 32;
const KEY_FILE = "engine-secret-key.bin";

function decodeKey(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const buffer = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  return buffer.length === KEY_BYTES ? buffer : null;
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function ensureEngineSecretKey({ safeStorage, userDataPath, environment = process.env }) {
  const supplied = decodeKey(environment.STARCORE_SECRET_KEY);
  if (supplied) return supplied.toString("base64");
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS credential encryption is unavailable; set STARCORE_SECRET_KEY to a 32-byte base64 or 64-character hex key",
    );
  }
  const keyPath = path.join(path.resolve(userDataPath), KEY_FILE);
  if (fs.existsSync(keyPath)) {
    const decrypted = safeStorage.decryptString(fs.readFileSync(keyPath));
    const key = decodeKey(decrypted);
    if (!key) throw new Error("Stored engine secret key is invalid");
    return key.toString("base64");
  }
  const generated = crypto.randomBytes(KEY_BYTES).toString("base64");
  atomicWrite(keyPath, safeStorage.encryptString(generated));
  return generated;
}

module.exports = { KEY_FILE, decodeKey, ensureEngineSecretKey };
