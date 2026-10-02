#!/usr/bin/env bash
#
# Start everything, in the order things actually depend on each other.
#
#   ./scripts/dev.sh          start it all
#   ./scripts/dev.sh --no-app skip the phone app (saves a slow Metro start)
#
# Ctrl-C stops every app. Postgres and Mailhog are containers and keep running,
# because losing the database on a stray Ctrl-C would mean reseeding.
# `npm run dev:stop` stops those too.

set -euo pipefail
cd "$(dirname "$0")/.."

WITH_APP=1
[[ "${1:-}" == "--no-app" ]] && WITH_APP=0

LOGS=".dev-logs"
mkdir -p "$LOGS"

say() { printf "\033[1;34m▸\033[0m %s\n" "$1"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; }

# Wait for a port to answer. Anything that replies counts — a 404 from the
# backend root still means it is listening, which is what we need to know.
wait_for() {
  local port=$1 name=$2 tries=${3:-90}
  for ((i = 1; i <= tries; i++)); do
    if curl -s -o /dev/null --max-time 2 "localhost:$port" 2>/dev/null; then
      ok "$name on :$port"
      return 0
    fi
    sleep 1
  done
  bad "$name did not come up on :$port — see $LOGS/$name.log"
  return 1
}

PIDS=()
stop() {
  echo
  say "Stopping"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  # Metro spawns children that outlive their parent.
  pkill -f "expo start" 2>/dev/null || true
  ok "apps stopped (Postgres and Mailhog are still up — npm run dev:stop)"
}
trap stop EXIT INT TERM

# ---------------------------------------------------------------------------
# Postgres lives in Docker, and on this machine Docker lives in Colima. A
# machine that was rebooted has neither, and "database did not come up" is a
# poor way to be told that.
say "Container runtime"
if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    say "  starting Colima (this takes a moment on a cold boot)"
    colima start >/dev/null 2>&1 || { bad "Colima would not start"; exit 1; }
  else
    bad "Docker is not running, and Colima is not installed. Start Docker and try again."
    exit 1
  fi
fi
ok "docker is up"

say "Database and mail"
docker compose -f apps/backend/docker-compose.yml up -d >/dev/null 2>&1 \
  || { bad "docker compose failed — see: docker compose -f apps/backend/docker-compose.yml up"; exit 1; }
wait_for 8025 mailhog 90

# Migrations before the backend: it reads the schema at boot, and a backend
# started against an out-of-date database fails in ways that look like code.
say "Migrations"
# From apps/backend, because Prisma reads DATABASE_URL from the .env beside the
# schema. Run from the repo root it finds no database and fails confusingly.
(
  cd apps/backend
  npx prisma migrate deploy >/dev/null 2>&1 || { echo "MIGRATE_FAILED"; exit 1; }
  # Reference data (§104): idempotent, and a database that was reset would
  # otherwise have no provinces, so every place filter would match nothing.
  npx prisma db execute --file prisma/reference-data.sql >/dev/null 2>&1 || true
) || { bad "migrations failed — run: cd apps/backend && npx prisma migrate deploy"; exit 1; }
ok "schema up to date"

# ---------------------------------------------------------------------------
say "Backend"
npm run backend:dev > "$LOGS/backend.log" 2>&1 &
PIDS+=($!)
wait_for 3000 backend 120

say "Web apps"
npm run dev --workspace apps/admin-web > "$LOGS/admin-web.log" 2>&1 &
PIDS+=($!)
npm run dev --workspace apps/business-web > "$LOGS/business-web.log" 2>&1 &
PIDS+=($!)
wait_for 5173 admin-web 60
wait_for 5174 business-web 60

if [[ $WITH_APP == 1 ]]; then
  say "Phone app"

  # Point the app at this machine's address on the wifi, not localhost.
  #
  # On a real phone "localhost" means the phone itself, so the app would find
  # no backend at all. A simulator is happy with either, so the LAN address is
  # simply always right — and it is rewritten on every start because it changes
  # whenever this machine joins a different network.
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -n "$LAN_IP" ]]; then
    printf '%s\n' \
      "# Written by scripts/dev.sh on every start — this machine's address on" \
      "# the wifi, so a real phone can reach the backend. Do not edit by hand." \
      "EXPO_PUBLIC_API_URL=http://$LAN_IP:3000" \
      > apps/customer-app/.env
    ok "app will call http://$LAN_IP:3000"
  else
    bad "not on a network — a real phone will not reach the backend"
  fi
  # Metro only. `expo start --ios` quits if the simulator deep link fails, and
  # it fails often enough to take the whole script down with it (§102.6).
  npm run start --workspace apps/customer-app > "$LOGS/customer-app.log" 2>&1 &
  PIDS+=($!)
  if wait_for 8081 customer-app 120; then
    if xcrun simctl list devices 2>/dev/null | grep -q Booted; then
      xcrun simctl openurl booted "exp://127.0.0.1:8081" >/dev/null 2>&1 \
        && ok "opened in the booted simulator"
    else
      printf "  open a simulator, then: \033[1mxcrun simctl openurl booted exp://127.0.0.1:8081\033[0m\n"
    fi
    [[ -n "${LAN_IP:-}" ]] && printf "  on a phone: open Expo Go and scan, or enter \033[1mexp://%s:8081\033[0m\n" "$LAN_IP"
  fi
fi

# ---------------------------------------------------------------------------
cat <<EOF

  Admin        http://localhost:5173
  Business     http://localhost:5174
  Backend      http://localhost:3000
  Email inbox  http://localhost:8025
$([[ $WITH_APP == 1 ]] && echo "  Phone app    exp://127.0.0.1:8081")

  Sign in with any demo-*@example.com address — the six-digit code
  arrives in the email inbox above, not a real mailbox.

  Logs in $LOGS/   ·   Ctrl-C to stop

EOF

# Hold the script open so Ctrl-C reaches the trap.
wait
