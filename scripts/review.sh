#!/bin/bash
# OpenStar Code Review Script

set -e

echo "🔍 OpenStar Code Review"
echo "======================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get branch
BRANCH=${1:-$(git branch --show-current)}
if [ -z "$BRANCH" ]; then
    echo -e "${RED}Error: Not on a branch${NC}"
    exit 1
fi

echo -e "${BLUE}Reviewing branch:${NC} $BRANCH"
echo ""

# Get changed files
echo -e "${BLUE}Changed files:${NC}"
git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~10..HEAD
echo ""

# Run checks
run_checks() {
    echo -e "${BLUE}Running checks...${NC}"
    echo ""

    # Type check
    echo -e "${YELLOW}Type check...${NC}"
    if bun run typecheck 2>&1; then
        echo -e "${GREEN}✓${NC} Type check passed"
    else
        echo -e "${RED}✗${NC} Type check failed"
    fi
    echo ""

    # Lint
    echo -e "${YELLOW}Linting...${NC}"
    if bun run lint 2>&1; then
        echo -e "${GREEN}✓${NC} Lint passed"
    else
        echo -e "${RED}✗${NC} Lint failed"
    fi
    echo ""

    # Tests
    echo -e "${YELLOW}Running tests...${NC}"
    if bun test 2>&1; then
        echo -e "${GREEN}✓${NC} Tests passed"
    else
        echo -e "${RED}✗${NC} Tests failed"
    fi
    echo ""
}

# Review output
review_output() {
    echo -e "${BLUE}AI Review Summary:${NC}"
    echo ""
    echo "Based on .agents/skills/openstar-self-review:"
    echo ""

    # Check for common issues
    echo "Checking for common issues..."

    # Check for any types
    ANY_TYPES=$(grep -r " : any" packages/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
    if [ -n "$ANY_TYPES" ]; then
        echo -e "${YELLOW}⚠${NC} Found 'any' types (should be avoided):"
        echo "$ANY_TYPES" | head -5
        echo ""
    fi

    # Check for console.log
    CONSOLE=$(grep -r "console\.log" packages/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
    if [ -n "$CONSOLE" ]; then
        echo -e "${YELLOW}⚠${NC} Found console.log (use proper logging):"
        echo "$CONSOLE" | head -5
        echo ""
    fi

    # Check for TODO comments
    TODOS=$(grep -r "TODO" packages/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
    if [ -n "$TODOS" ]; then
        echo -e "${YELLOW}⚠${NC} Found TODO comments:"
        echo "$TODOS" | head -5
        echo ""
    fi

    # Check for missing exports
    echo "Checking package exports..."
    for pkg in packages/*/package.json; do
        name=$(grep '"name"' "$pkg" | cut -d'"' -f4)
        src_dir=$(dirname "$pkg")/src
        if [ -d "$src_dir" ]; then
            exports=$(grep -l "export " "$src_dir"/*.ts 2>/dev/null | wc -l)
            echo "  $name: $exports files with exports"
        fi
    done
    echo ""
}

# Main
run_checks
review_output

echo -e "${GREEN}===================${NC}"
echo -e "${GREEN}✅ Review complete!${NC}"
echo -e "${GREEN}===================${NC}"
