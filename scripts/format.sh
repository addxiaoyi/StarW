#!/bin/bash
# StarCore Format Script
# 代码格式化

set -e

echo "📝 Formatting StarCore..."
echo ""

cd "$(dirname "$0")/.."

# TypeScript/JS 格式化
echo "   Formatting TypeScript/JS..."
bunx prettier --write "packages/*/src/**/*.ts" "packages/*/src/**/*.tsx" 2>/dev/null || true

# JSON 格式化
echo "   Formatting JSON..."
bunx prettier --write "package.json" "packages/*/package.json" 2>/dev/null || true

# Markdown 格式化
echo "   Formatting Markdown..."
bunx prettier --write "*.md" ".claude/**/*.md" 2>/dev/null || true

echo ""
echo "✅ Formatting complete!"
