#!/bin/sh
set -eu
cd /workspace
for project in server web admin; do
  digest=$(sha256sum "$project/package-lock.json" | cut -d ' ' -f 1)
  previous=$(cat "$project/node_modules/.resihub-lock" 2>/dev/null || true)
  if [ "$digest" != "$previous" ]; then
    (cd "$project" && npm ci --no-audit --no-fund)
    printf '%s' "$digest" > "$project/node_modules/.resihub-lock"
  fi
done
node server/scripts/initialize-local.js
(cd web && npm run build)
(cd admin && npm run build)
cd server
exec node src/index.js
