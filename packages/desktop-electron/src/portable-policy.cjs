"use strict";

const path = require("node:path");

function readNonEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolvePortableUserDataPath(env = process.env) {
  const root =
    readNonEmpty(env.OPENSTAR_PORTABLE_DATA_DIR) ||
    readNonEmpty(env.PORTABLE_EXECUTABLE_DIR);
  return root ? path.join(path.resolve(root), "OpenStar-Data") : null;
}

module.exports = { resolvePortableUserDataPath };
