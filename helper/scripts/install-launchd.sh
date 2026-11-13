#!/bin/bash
# Installs the helper as a macOS LaunchAgent so it starts at login and restarts if it stops.
set -euo pipefail
HELPER="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "Node.js not found. Install it first (see README)."; exit 1; }
[ -f "$HELPER/config.json" ] || { echo "Create $HELPER/config.json first (copy config.example.json)."; exit 1; }
chmod 600 "$HELPER/config.json"
DEST="$HOME/Library/LaunchAgents/com.printarchive.helper.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s#__NODE__#$NODE#g" -e "s#__HELPER__#$HELPER#g" -e "s#__HOME__#$HOME#g" \
  "$HELPER/launchd/com.printarchive.helper.plist.template" > "$DEST"
launchctl bootout "gui/$(id -u)/com.printarchive.helper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Installed and started. Logs: ~/Library/Logs/print-archive-helper.log"
PORT="$("$NODE" -p "require(process.argv[1]).port || 8787" "$HELPER/config.json" 2>/dev/null || echo 8787)"
echo "Open http://$(scutil --get LocalHostName 2>/dev/null || hostname -s).local:$PORT/ in Safari on your iPhone, then Share -> Add to Home Screen."
