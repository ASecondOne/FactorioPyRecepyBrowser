#!/usr/bin/env bash
# Re-extract recipes/machines/icons from your installed Factorio + mods (run after mod updates).
# Uses a separate write-data dir, so it works even while the game is running.
set -e
PROJ="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
FACTORIO="${FACTORIO:-$HOME/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio}"
MODS="${MODS:-$HOME/.factorio/mods}"
TMP="$(mktemp -d /tmp/pyplan-dump.XXXX)"
printf '[path]\nread-data=__PATH__executable__/../../data\nwrite-data=%s\n' "$TMP" > "$TMP/config.ini"
export SteamAppId=427520 SteamGameId=427520   # stops the Steam build from relaunching itself via Steam
"$FACTORIO" --config "$TMP/config.ini" --mod-directory "$MODS" --dump-data > "$TMP/log1.txt" 2>&1
mv "$TMP/script-output/data-raw-dump.json" "$TMP/"
"$FACTORIO" --config "$TMP/config.ini" --mod-directory "$MODS" --dump-prototype-locale > "$TMP/log2.txt" 2>&1
"$FACTORIO" --config "$TMP/config.ini" --mod-directory "$MODS" --dump-icon-sprites > "$TMP/log3.txt" 2>&1
mv "$TMP/data-raw-dump.json" "$TMP/script-output/"
rm -rf "$PROJ/static/icons"
python3 "$PROJ/tools/process_dump.py" "$TMP/script-output" "$PROJ"
rm -rf "$TMP"
echo "done – restart the planner"
