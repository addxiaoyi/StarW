// Run vitest detached; print a terminal marker so the watcher can detect completion.
import { spawnSync } from "node:child_process";

const extra = process.argv.slice(2);
const args = ["node_modules/vitest/vitest.mjs", "run", "--watch=false", "--reporter=dot", ...extra];

const res = spawnSync("node", args, { cwd: process.cwd(), stdio: "inherit", env: process.env });

console.log("\n__TESTS_DONE__ exit=" + (res.status ?? 1));
process.exit(res.status ?? 1);
