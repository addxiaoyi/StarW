#!/usr/bin/env bash
# OpenStar Binary Packaging Script
# Creates a standalone executable for OpenStar CLI
set -euo pipefail

VERSION="0.1.0"
OUTPUT_DIR="dist"
BINARY_NAME="openstar"

echo "📦 Packaging OpenStar v${VERSION}..."

# Ensure dist exists
mkdir -p "$OUTPUT_DIR"

# Build CLI with Bun (creates single executable)
if command -v bun &> /dev/null; then
  echo "  → Using Bun to build standalone binary"
  bun build packages/cli/src/index.ts \
    --compile \
    --outfile "$OUTPUT_DIR/$BINARY_NAME" \
    --target bun \
    --sourcemap=external
else
  echo "  ⚠ Bun not found, building with tsc + esbuild"
  npx tsc --build packages/cli
  npx esbuild packages/cli/dist/index.js \
    --bundle \
    --platform=node \
    --outfile "$OUTPUT_DIR/$BINARY_NAME" \
    --format=cjs
fi

# Create platform-specific archives
PLATFORM="$(uname -s)-$(uname -m)"
case "$PLATFORM" in
  "Linux-x86_64") ARCH="linux-amd64" ;;
  "Darwin-x86_64") ARCH="darwin-amd64" ;;
  "Darwin-arm64") ARCH="darwin-arm64" ;;
  "MINGW"*|"MSYS"*|"CYGWIN"*) ARCH="windows-amd64"; BINARY_NAME="$BINARY_NAME.exe" ;;
  *) ARCH="$PLATFORM" ;;
esac

ARCHIVE="$OUTPUT_DIR/openstar-$VERSION-$ARCH.tar.gz"
if command -v tar &> /dev/null; then
  tar -czf "$ARCHIVE" -C "$OUTPUT_DIR" "$BINARY_NAME"
  echo "  ✓ Created $ARCHIVE"
fi

# Generate install script
cat > "$OUTPUT_DIR/install.sh" << 'EOF'
#!/usr/bin/env bash
# OpenStar install script
set -euo pipefail
BINARY="openstar"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) INSTALL_DIR="$LOCALAPPDATA/Programs/OpenStar" ;;
esac
mkdir -p "$INSTALL_DIR"
cp "$BINARY" "$INSTALL_DIR/$BINARY"
echo "✓ OpenStar installed to $INSTALL_DIR/$BINARY"
echo "  Run 'openstar --help' to get started"
EOF
chmod +x "$OUTPUT_DIR/install.sh"

echo "✓ Packaging complete!"
echo "  Binary: $OUTPUT_DIR/$BINARY_NAME"
echo "  Installer: $OUTPUT_DIR/install.sh"
