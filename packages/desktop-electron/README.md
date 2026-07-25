# OpenStar Desktop (Electron) 🖥️

> Warp Terminal 风格桌面应用，集成 StarCore + Skills + Agent Swarm

---

## ✅ 快速启动

```bash
# 开发模式（自动开启 ui-web dev server）
bun run dev:desktop

# 生产构建+本地测试
bun run build:desktop
```

确保 `packages/ui-web` 已构建/启动，Electron 将加载 Solid UI 的产物（`packages/ui-web/dist/index.html`），禁止加载任何旧版静态 HTML 路径，否则立即退出以避免退化。

---

## 📦 产物路径

- 开发模式：从 `http://127.0.0.1:4444` 加载 （由 `packages/ui-web` Vite dev server 提供）
- 生产模式：packages/ui-web 构建输出 → 资源目录 `/ui-web/index.html` → Electron 加载产物

---

## 🛠️ 架构

- 主进程：`packages/desktop-electron/src/main.cjs`（按环境与 isPackaged 决定加载逻辑）
- UI 前端：`packages/ui-web`（Solid.js + Vite + Tailwind）
- 启动器：`window-target.cjs` 确保路径正确，避免误用旧入口（`warp-master` 等残余目录）。

---

## ⚠️ 避坑指南

1. 工作区路径：`packages/desktop-electron`
2. `yarn` / `npm` 命令请勿使用；用项目统一管理的 `bun`。
3. 如需重新构建前端，运行 `bun run --cwd packages/ui-web build`，产物必须在 `dist/index.html`，否则 Electron 不加载直接异常退出。
4. Electron 启动时传 `--no-sandbox` 等降级沙箱参数属高危，禁止滥用；违规行为由此文件明确禁止与回退工程改动。
