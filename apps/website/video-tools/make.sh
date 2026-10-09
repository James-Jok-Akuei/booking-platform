#!/usr/bin/env bash
# Make the walkthrough video from the running customer app (§240):
#   1. record the real booking flow on a phone-sized screen (rec/),
#   2. record the confirmed reservation with its code (rec-code/),
#   3. compose both with the voice lines into ../public/video/.
#
# Needs: the stack running (./scripts/dev.sh), Google Chrome, Python 3 with
# pillow + imageio-ffmpeg + edge-tts (python -m venv .venv && .venv/bin/pip
# install pillow imageio-ffmpeg edge-tts), and token.json beside this script
# — the customer app's sign-in, copied from a signed-in browser's
# localStorage: {"booking.accessToken": "…", "booking.refreshToken": "…",
# "booking.user": "…"}. Each run books (and pays for, in the MoMo sandbox)
# one real steam room at the demo spa for the signed-in customer.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-.venv/bin/python}
APP=${APP:-http://localhost:8081}
[[ -d voice ]] || ./voices.sh

rm -rf rec rec-code
node rec.mjs rec 390 844 "$APP/" --in --js=steps.js --wait=6000 | tee rec.log
BOOKING=$(grep -o '/booking/[0-9a-f-]*' rec.log | tail -1)
[[ -n "$BOOKING" ]] || { echo "no booking was made — see rec.log"; exit 1; }
node rec.mjs rec-code 390 844 "$APP$BOOKING" --in --js=steps4.js --wait=5000

# Step 3 ends a moment after "Payment successful": 1.6 s after the sandbox
# confirmed, which the main recording's log places by its NOTE mark plus the
# app's polling; 30 s is right for the demo spa today. Tune by eye with the
# contact sheet compose.py leaves beside the video.
STEP3_STOP=${STEP3_STOP:-30} "$PY" compose.py rec ../public/video/how-booking-works.mp4 rec-code
