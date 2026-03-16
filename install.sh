#!/bin/bash
set -e

REPO="https://github.com/codebypanduro/storm-agent.git"
INSTALL_DIR="$HOME/.storm-agent"

echo "Installing storm-agent..."

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
if ! command -v bun &> /dev/null; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun install

# Create symlink
LINK_DIR="$HOME/.local/bin"
mkdir -p "$LINK_DIR"
ln -sf "$INSTALL_DIR/index.ts" "$LINK_DIR/storm"
chmod +x "$INSTALL_DIR/index.ts"

echo ""
echo "storm-agent installed!"
echo ""
echo "Make sure $LINK_DIR is in your PATH:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo ""
echo "Then run: storm init"
