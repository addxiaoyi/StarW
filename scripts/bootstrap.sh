#!/bin/bash
# StarCore Bootstrap Script
# 初始化开发环境

set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║   StarCore v0.1.0                               ║"
echo "║   Skill + MCP + Agent Swarm Platform            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 检查 Bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Please install Bun first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✓ Bun version: $(bun --version)"
echo ""

# 安装依赖
echo "📦 Installing dependencies..."
bun install
echo ""

# 类型检查
echo "🔍 Running typecheck..."
bun run typecheck
echo ""

echo "✅ StarCore ready!"
echo ""
echo "Next steps:"
echo "  bun run dev           # Start Web UI"
echo "  bun run dev:cli       # Start CLI"
echo "  bun run build         # Build for production"
