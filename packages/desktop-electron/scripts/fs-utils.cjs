"use strict";

const fs = require("node:fs");
const path = require("node:path");

function removePath(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of fs.readdirSync(target)) {
      removePath(path.join(target, entry));
    }
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
  if (fs.existsSync(target)) {
    throw new Error(`Failed to remove path: ${target}`);
  }
}

module.exports = { removePath };
