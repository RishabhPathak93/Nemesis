#!/bin/bash
# Regenerate the CortexView launcher apps with the current absolute project
# path baked in. Run from the project root after moving/renaming the project:
#
#   cd <project-root>
#   ./launcher/build-launcher.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Apps to refresh: ":bake" if the script needs PROJECT_ROOT rewritten, ":nobake" otherwise.
APPS=(
  "$PROJECT_ROOT/CortexView.app:Contents/MacOS/CortexView:bake"
  "$PROJECT_ROOT/Stop CortexView.app:Contents/MacOS/StopCortexView:nobake"
)

for entry in "${APPS[@]}"; do
  IFS=':' read -r app rel mode <<< "$entry"
  exec_path="$app/$rel"
  if [ ! -f "$exec_path" ]; then
    echo "WARNING: $exec_path not found — skipping"
    continue
  fi

  if [ "$mode" = "bake" ]; then
    TMP=$(mktemp)
    awk -v root="$PROJECT_ROOT" '
      /^PROJECT_ROOT="/ { print "PROJECT_ROOT=\"" root "\""; next }
      { print }
    ' "$exec_path" > "$TMP"
    mv "$TMP" "$exec_path"
  fi

  chmod +x "$exec_path"
  /usr/bin/touch "$app"
  /usr/bin/touch "$app/Contents/Info.plist"
  echo "✓ $(basename "$app") refreshed"
done

echo ""
echo "Project root baked in: $PROJECT_ROOT"
echo "Double-click CortexView.app to start, Stop CortexView.app to stop."
