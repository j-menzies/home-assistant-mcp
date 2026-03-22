#!/bin/bash
# Wrapper script for Claude Desktop stdio transport.
# Claude Desktop spawns subprocesses with a minimal PATH, so tools
# installed via nvm, fnm, volta, or Homebrew may not be found.
# This script locates the correct Node.js and runs the compiled server.

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Diagnostic output goes to stderr (won't corrupt JSON-RPC on stdout)
log() { echo "$1" >&2; }

# Add common Homebrew paths (Apple Silicon + Intel)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Initialise fnm if available
if command -v fnm &>/dev/null; then
  log "[wrapper] Initialising fnm..."
  eval "$(fnm env)"
elif [ -x "$HOME/.local/share/fnm/fnm" ]; then
  log "[wrapper] Found fnm at ~/.local/share/fnm..."
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)"
elif [ -x "$HOME/.fnm/fnm" ]; then
  log "[wrapper] Found fnm at ~/.fnm..."
  export PATH="$HOME/.fnm:$PATH"
  eval "$(fnm env)"
# Fallback to nvm
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  log "[wrapper] Sourcing nvm..."
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
# Fallback to volta
elif [ -d "$HOME/.volta" ]; then
  log "[wrapper] Adding volta to PATH..."
  export PATH="$HOME/.volta/bin:$PATH"
fi

# Verify we can find node
if ! command -v node &>/dev/null; then
  log "[wrapper] ERROR: Cannot find node in PATH: $PATH"
  exit 1
fi

log "[wrapper] Using node: $(command -v node) ($(node --version))"

# Build if dist/stdio.js is missing or older than source
if [ ! -f "$DIR/dist/stdio.js" ] || [ "$DIR/src/stdio.ts" -nt "$DIR/dist/stdio.js" ]; then
  log "[wrapper] Building TypeScript..."
  npx tsc 2>&1 >&2
fi

# Run the compiled server directly with node -- no tsx, no npx noise
exec node dist/stdio.js
