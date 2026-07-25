# 🖥️ Electron Desktop 开发指南

## 启动完整开发环境（两步走）

**窗口 1 — Vite dev server（Solid UI 前端）：**
```bash
cd packages/ui-web
bunx vite --port 4446 --host 127.0.0.1
```

**窗口 2 — Electron（加载上面的 dev server）：**
```bash
set OPENSTAR_DEV_SERVER_URL=http://127.0.0.1:4446
cd packages/desktop-electron
bunx electron .
```

> ⚠️ 必须先启动窗口 1（等待 `Local: http://127.0.0.1:4446` 出现），再启动窗口 2。
> Electron 会从 `OPENSTAR_DEV_SERVER_URL` 读取 Vite dev server，否则会尝试从文件路径加载 `packages/ui-web/dist/index.html`（需先 `bun run build:ui`）。

## 一行脚本（Windows CMD）

```cmd
start "OpenStar: Vite" cmd /c "cd /d D:\qwq\项目\claudegod\packages\ui-web && bunx vite --port 4446 --host && pause"
start "OpenStar: Electron" cmd /c "cd /d D:\qwq\项目\claudegod\packages\desktop-electron && set OPENSTAR_DEV_SERVER_URL=http://127.0.0.1:4446 && bunx electron . && pause"
```

## 生产构建

```bash
# 构建 Solid UI 产物（packages/ui-web/dist/index.html）
bun run build:ui

# 构建 Electron 应用包
cd packages/desktop-electron
bunx electron-builder
```

## 避坑要点

- `OPENSTAR_DEV_SERVER_URL` 必须设，否则 Electron 直接读 `dist/index.html`（若未 build 则报 "Solid renderer not found"）
- 移除 `@tailwindcss/vite` 和 tailwindcss 依赖（ESM + Bun 的 `require()` 冲突），用标准 CSS 或 PostCSS 替代
- 旧目录 `warp-master/` 不会自动加载，Electron 只认 `packages/ui-web` 下的产物
