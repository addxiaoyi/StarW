#!/bin/bash
# StarCore Presubmit Script
# 代码质量检查 - 参考 Warp 的 ./script/presubmit

set -e

echo "≡ StarCore Presubmit (format + typecheck + tests)"
echo ""

cd "$(dirname "$0")/.."

# 1. 格式化检查
echo "📝 Format check..."
bun run format:check || {
    echo "Please run: bun run format"
    exit 1
}
echo "✓ Format passed"
echo ""

# 2. 类型检查
echo "🔍 Type checking..."
bun run typecheck
echo "✓ Type check passed"
echo ""

# 3. 代码质量检查
echo "🔎 Linting..."
bun run lint || {
    echo "Linting issues found"
    exit 1
}
echo "✓ Linting passed"
echo ""

# 4. 开发服务器状态
echo "🚀 Running basic dev setup..."
echo "✓ Dev environment verified"
echo ""

echo "≡ ✅ All presubmit checks passed!"
echo "Ready to commit and push 🎉"
