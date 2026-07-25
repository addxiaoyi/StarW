#!/bin/bash
# OpenStar Changelog Generator

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse args
CHANNEL="stable"
RELEASE_TAG=""
FROM_TAG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --channel)
            CHANNEL="$2"
            shift 2
            ;;
        --release-tag)
            RELEASE_TAG="$2"
            shift 2
            ;;
        --from)
            FROM_TAG="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$RELEASE_TAG" ]; then
    echo -e "${RED}Error: --release-tag is required${NC}"
    exit 1
fi

echo "📝 OpenStar Changelog Generator"
echo "==============================="
echo "Channel: $CHANNEL"
echo "Release: $RELEASE_TAG"
echo ""

# Get previous tag if not provided
if [ -z "$FROM_TAG" ]; then
    FROM_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
fi

echo "From: $FROM_TAG"
echo ""

# Generate changelog file
OUTPUT_FILE="changelog-draft.md"
echo "# OpenStar Changelog" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "**Channel:** $CHANNEL" >> "$OUTPUT_FILE"
echo "**Release:** $RELEASE_TAG" >> "$OUTPUT_FILE"
echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Get commits since last release
if [ -n "$FROM_TAG" ]; then
    COMMITS=$(git log --oneline "$FROM_TAG..HEAD" 2>/dev/null || echo "No previous commits")
else
    COMMITS=$(git log --oneline -20)
fi

echo "## Changes" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo '\`\`\`' >> "$OUTPUT_FILE"
echo "$COMMITS" >> "$OUTPUT_FILE"
echo '\`\`\`' >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Categorize changes
echo "## New Features" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "## Improvements" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "## Bug Fixes" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Community section
echo "## Community" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "### Contributors" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "### Issue Reporters" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo -e "${GREEN}✓${NC} Changelog generated: $OUTPUT_FILE"
echo ""

# Also generate JSON
JSON_OUTPUT="changelog-draft.json"
cat > "$JSON_OUTPUT" << EOF
{
  "channel": "$CHANNEL",
  "release_tag": "$RELEASE_TAG",
  "from_tag": "$FROM_TAG",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commits": $(echo "$COMMITS" | while read -r line; do echo "\"$line\""; done | paste -sd, - | sed 's/^/[/;s/$/]/' || echo "[]")
}
EOF

echo -e "${GREEN}✓${NC} JSON generated: $JSON_OUTPUT"
