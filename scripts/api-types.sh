#!/usr/bin/env bash
# Regenerates the API contract and the client types for all three apps.
#
# One command, because three clients generated from different versions of
# docs/openapi.json is the same silent drift the contract exists to prevent.
#
# The generator is run from apps/admin-web/node_modules rather than installed at
# the root or per app, and that is deliberate:
#
#   * a root devDependency forces a root `npm install`, which currently fails on
#     a pre-existing peer conflict in apps/backend (@nestjs/schematics wants
#     TypeScript >= 6, the backend pins 5.9);
#   * installing it in apps/customer-app fails too — openapi-typescript@7 peers
#     on TypeScript ^5.x and Expo SDK 57 pins TypeScript 6;
#   * `npx -y openapi-typescript` cannot fetch in this environment.
#
# admin-web already has it, pinned, with a TypeScript that satisfies the peer.
# The output is byte-identical for all three apps, so which copy of the tool runs
# makes no difference to the result.
set -euo pipefail
cd "$(dirname "$0")/.."

GEN=apps/admin-web/node_modules/.bin/openapi-typescript
if [[ ! -x $GEN ]]; then
  echo "The generator is missing. Run: npm install --workspace apps/admin-web" >&2
  exit 1
fi

echo "==> docs/openapi.json, from the backend's DTOs"
npm run openapi:generate --workspace apps/backend

for app in admin-web business-web customer-app; do
  echo "==> apps/$app/src/api/schema.d.ts"
  "$GEN" docs/openapi.json -o "apps/$app/src/api/schema.d.ts"
done
