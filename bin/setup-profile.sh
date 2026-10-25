#!/bin/sh
# Create (or refresh) the DSH profile "reader" that boots this repo's plugin.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/reader"
mkdir -p "$PROFILE/node_modules"

# Tavern's skin (its bundled dsh-dream-skin with the Terracotta palettes), shared from a dsh-tavern
# checkout beside this repo; override with DSH_TAVERN_ROOT. Without it the reader runs on DSH's own theme.
TAVERN_ROOT="${DSH_TAVERN_ROOT:-$ROOT/../dsh-tavern}"
SKIN="$TAVERN_ROOT/tavern-plugin/packages/dsh-dream-skin"
if [ -f "$SKIN/package.json" ]; then
  SKIN=$(cd "$SKIN" && pwd)
  SKIN_DEP=", \"dsh-dream-skin\": \"link:$SKIN\""
  SKIN_BUNDLE=', "dsh-dream-skin"'
  ln -sfn "$SKIN" "$PROFILE/node_modules/dsh-dream-skin"
  echo "skin: tavern dream skin from $SKIN"
else
  SKIN_DEP=""
  SKIN_BUNDLE=""
  rm -f "$PROFILE/node_modules/dsh-dream-skin"
  echo "skin: dsh-tavern not found at $TAVERN_ROOT, using DSH's own theme"
fi

# dsh-pocket: phone access (LAN + public tunnel), same version as dsh-tavern's. Its port is set in
# plugin/cordis.patch.yml so it does not collide with tavern's pocket on 3081.
POCKET_VERSION=2.12.0

BASE=$(cat <<JSON
{
  "name": "dsh-profile-reader",
  "private": true,
  "dependencies": { "dsh-pocket": "$POCKET_VERSION", "dsh-reader": "link:$ROOT/plugin"$SKIN_DEP },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-pocket"$SKIN_BUNDLE, "dsh-reader"],
      "patchReload": "live"
    }
  }
}
JSON
)
# Plugins added to the profile since (dsh plugin --profile reader add …, e.g. dsh-codex-subscription)
# are kept: their dependencies stay, and their bundles stay just before dsh-reader so the reader's own
# UI still comes last.
BASE="$BASE" node -e '
  const { readFileSync, writeFileSync } = require("node:fs")
  const file = process.argv[1]
  const next = JSON.parse(process.env.BASE)
  let old = {}
  try { old = JSON.parse(readFileSync(file, "utf8")) } catch {}
  const managed = new Set(["dsh-pocket", "dsh-reader", "dsh-dream-skin"])
  for (const [name, spec] of Object.entries(old.dependencies ?? {})) if (!managed.has(name)) next.dependencies[name] = spec
  const bundles = next.dsh.profile.bundles
  const extra = (old.dsh?.profile?.bundles ?? []).filter((b) => !bundles.includes(b) && !managed.has(b))
  bundles.splice(bundles.indexOf("dsh-reader"), 0, ...extra)
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
' "$PROFILE/package.json"
[ -f "$PROFILE/cordis.yml" ] || printf '[]\n' > "$PROFILE/cordis.yml"
[ -f "$PROFILE/cordis.patch.yml" ] || printf '[]\n' > "$PROFILE/cordis.patch.yml"
ln -sfn "$ROOT/plugin" "$PROFILE/node_modules/dsh-reader"
dsh plugin --profile reader install
echo "profile ready: $PROFILE"

# Put the service command beside `dsh` so `dsh-reader start|stop|restart|status|open` works anywhere.
DSH_BIN=$(dirname "$(command -v dsh)")
ln -sfn "$ROOT/bin/dsh-reader.mjs" "$DSH_BIN/dsh-reader"
echo "command ready: dsh-reader start | stop | restart | status | open"
