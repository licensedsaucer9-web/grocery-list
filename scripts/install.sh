#!/bin/sh
# Install the grocery-list sync job for the current user. Idempotent.
# Never touches ~/.config/grocery-list/env and does not enable the timer.
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HOME/.local/grocery-list"
UNITS="$HOME/.config/systemd/user"
NODE_BIN=$(command -v node) || { echo "node not found in PATH" >&2; exit 1; }
REMOTE=$(git -C "$SRC" remote get-url origin)

echo "Building sync bundle..."
(cd "$SRC" && npm ci --silent && npm run --silent build:sync)

mkdir -p "$DEST" "$UNITS"
install -m 644 "$SRC/dist-sync/sync.mjs" "$DEST/sync.mjs"
install -m 755 "$SRC/scripts/run-sync.sh" "$DEST/run-sync.sh"
printf 'NODE_BIN=%s\n' "$NODE_BIN" > "$DEST/config"

# Separate clone so a dev checkout is never reset or dirtied by the sync.
if [ ! -d "$DEST/repo/.git" ]; then
  git clone --quiet "$REMOTE" "$DEST/repo"
else
  git -C "$DEST/repo" remote set-url origin "$REMOTE"
fi

install -m 644 "$SRC/systemd/grocery-list-sync.service" "$UNITS/grocery-list-sync.service"
install -m 644 "$SRC/systemd/grocery-list-sync.timer" "$UNITS/grocery-list-sync.timer"
systemctl --user daemon-reload 2>/dev/null || echo "note: systemctl --user daemon-reload failed; run it manually"

if [ ! -f "$HOME/.config/grocery-list/env" ]; then
  echo "WARNING: ~/.config/grocery-list/env is missing; the sync will fail until NOTION_TOKEN is set (see README)."
fi
cat <<MSG
Installed to $DEST (node: $NODE_BIN).
Next:
  systemctl --user enable --now grocery-list-sync.timer
  systemctl --user start grocery-list-sync.service   # test run
  journalctl --user -u grocery-list-sync -n 50
MSG
