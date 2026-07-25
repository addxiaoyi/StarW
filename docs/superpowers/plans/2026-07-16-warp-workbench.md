# Warp Workbench Rebuild

## Goal

Replace the retired Electron HTML shell with the Solid.js workbench, then rebuild the first screen around Warp's workspace/session/terminal model and OpenCode's focused, lazy-loaded application structure.

## Steps

1. Add a main-process target resolver test: development loads the Vite URL, production loads `packages/ui-web/dist/index.html`, and neither path uses `desktop-electron/src/index.html`.
2. Update Electron startup to resolve and load that target, report load failures clearly, and show the window only after the new renderer is ready.
3. Replace the current renderer shell with a Warp-style workbench: workspace/session rail, terminal block timeline, command composer, and AI context inspector.
4. Keep secondary views lazy-loaded so terminal startup does not eagerly evaluate every feature module.
5. Run focused tests, UI typecheck/build, and launch Electron against the built renderer for visual verification.

## Guardrails

- Preserve the preload bridge and existing service/store contracts.
- Do not modify or clean unrelated dirty-worktree files.
- Keep interaction state explicit, with usable loading, empty, and failure states.
