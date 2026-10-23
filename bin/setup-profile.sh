#!/bin/sh
# Create (or refresh) the DSH profile "reader" that boots this repo's plugin.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/reader"
mkdir -p "$PROFILE/node_modules"
cat > "$PROFILE/package.json" <<JSON
{
  "name": "dsh-profile-reader",
  "private": true,
  "dependencies": { "dsh-reader": "link:$ROOT/plugin" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-reader"],
      "patchReload": "live"
    }
  }
}
JSON
[ -f "$PROFILE/cordis.yml" ] || printf '[]\n' > "$PROFILE/cordis.yml"
[ -f "$PROFILE/cordis.patch.yml" ] || printf '[]\n' > "$PROFILE/cordis.patch.yml"
ln -sfn "$ROOT/plugin" "$PROFILE/node_modules/dsh-reader"
echo "profile ready: $PROFILE"
echo "start: dsh --profile reader"
