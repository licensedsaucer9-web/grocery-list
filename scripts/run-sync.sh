#!/bin/sh
# Run by grocery-list-sync.service from ~/.local/grocery-list/.
# Pull, sync Notion -> public/list.json, commit + push only if it changed.
set -eu
HERE=$(dirname "$(readlink -f "$0")")
. "$HERE/config"
cd "$HERE/repo"

git pull --ff-only --quiet
"$NODE_BIN" "$HERE/sync.mjs"

git add public/list.json
if git diff --cached --quiet -- public/list.json; then
  echo "list.json unchanged; nothing to commit"
  exit 0
fi
week=$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync("public/list.json", "utf8")).week_start)')
git commit --quiet -m "chore: sync list (week $week)" -- public/list.json
git push --quiet
echo "pushed list.json for week $week"
