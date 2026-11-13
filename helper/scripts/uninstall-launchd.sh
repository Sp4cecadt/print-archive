#!/bin/bash
set -euo pipefail
launchctl bootout "gui/$(id -u)/com.printarchive.helper" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.printarchive.helper.plist"
echo "Helper removed from login items. Your archive folder was not touched."
