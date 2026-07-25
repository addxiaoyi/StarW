#!/bin/bash
# dev:desktop - 启动 OpenStar Desktop (Vite + Electron)
# 替代旧的 bash scripts/dev-desktop.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
UI_DIR="$ROOT_DIR/packages/ui-web"
DESKTOP_DIR="$ROOT_DIR/packages/desktop-electron"
VITE_PORT=4446

echo "⚡ 启动 OpenStar Desktop..."

# 1. 杀掉旧进程，释放端口
echo "→ 清理旧进程..."
for pid in $(netstat -ano 2>/dev/null | grep ":$VITE_PORT " | awk '{print $5}' | cut -d: -f1 | sort -u); do
  [ -n "$pid" ] && [ "$pid" != "0" ] && taskkill //F //PID "$pid" 2>/dev/null || true
done

# 2. 启动 Vite dev server
echo "→ 启动 Vite dev server (port $VITE_PORT)..."
cd "$UI_DIR"
npx vite --port $VITE_PORT > /dev/null 2>&1 &
VITE_PID=$!

# 3. 等待 Vite 就绪
echo "→ 等待 Vite 启动..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:$VITE_PORT/ > /dev/null 2>&1; then
    echo "✓ Vite 已就绪 (http://127.0.0.1:$VITE_PORT/)"
    break
  fi
  [ $i -eq 30 ] && echo "✗ Vite 启动超时" && exit 1
  sleep 1
done

# 4. 启动 Electron
ELECTRON_BIN="$ROOT_DIR/node_modules/.bin/electron"
if [ ! -f "$ELECTRON_BIN" ]; then
  ELECTRON_BIN="$ROOT_DIR/node_modules/.bun/electron@43.1.0+759ce506b1ed1a42/node_modules/electron/dist/electron.exe"
fi

echo "→ 启动 Electron..."
cd "$DESKTOP_DIR"
OPENSTAR_DEV_SERVER_URL="http://127.0.0.1:$VITE_PORT" \
OPENSTAR_OPEN_DEVTOOLS=1 \
  "$ELECTRON_BIN" .

# Electron 退出时清理 Vite
kill $VITE_PID 2>/dev/null || true
