"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { resolvePortableUserDataPath } = require("../src/portable-policy.cjs");

test("uses the explicit portable data root when provided", () => {
  const result = resolvePortableUserDataPath({
    OPENSTAR_PORTABLE_DATA_DIR: "D:/portable-data",
    PORTABLE_EXECUTABLE_DIR: "D:/application",
  });
  assert.equal(result, path.resolve("D:/portable-data", "OpenStar-Data"));
});

test("stores data beside the portable executable by default", () => {
  const result = resolvePortableUserDataPath({
    PORTABLE_EXECUTABLE_DIR: "D:/OpenStar",
  });
  assert.equal(result, path.resolve("D:/OpenStar", "OpenStar-Data"));
});

test("uses the normal Electron userData location outside portable mode", () => {
  assert.equal(resolvePortableUserDataPath({}), null);
});
