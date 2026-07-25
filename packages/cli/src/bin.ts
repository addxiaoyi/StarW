/**
 * OpenStar CLI binary entry.
 *
 * All command definitions live in ./index.ts. This file exists only because
 * package.json `bin` points here; it bootstraps the real CLI so there is a
 * single source of truth for commands (TUI, serve, gateway, dag, config…).
 */
import "./index.js";
