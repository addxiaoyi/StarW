#!/bin/bash

# OpenStar 快速构建脚本

echo "🔧 OpenStar 快速构建"
echo "================================================"

# 检查 Bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun 未安装! 请先安装: https://bun.sh"
    exit 1
fi

# 获取版本
BUN_VERSION=$(bun --version)
echo "📦 Bun 版本: $BUN_VERSION"

# 安装依赖
echo ""
echo "📦 安装项目依赖..."
bun install
if [ $? -eq 0 ]; then
    echo "✅ 依赖安装完成"
else
    echo "❌ 依赖安装失败"
    exit 1
fi

# 类型检查
echo ""
echo "🔍 TypeScript 类型检查..."
bun run typecheck
if [ $? -eq 0 ]; then
    echo "✅ 类型检查通过"
else
    echo "⚠️ 类型检查有警告 (可继续)"
fi

# 构建 Web UI
echo ""
echo "🌐 构建 Web UI..."
cd packages/ui-web
bun run build
if [ $? -eq 0 ]; then
    echo "✅ Web UI 构建完成"
else
    echo "❌ Web UI 构建失败"
fi
cd ../..

# 构建 CLI
echo ""
echo "⚡ 构建 CLI..."
cd packages/cli
bun run build
if [ $? -eq 0 ]; then
    echo "✅ CLI 构建完成"
else
    echo "❌ CLI 构建失败"
fi
cd ../..

echo ""
echo "================================================"
echo "🎉 构建完成!"
echo ""
echo "启动命令:"
echo "  bun run dev:cli      # CLI 界面"
echo "  bun run dev          # Web UI"
echo "  cd packages/desktop-electron && npm run dev  # Electron"
