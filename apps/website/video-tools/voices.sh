#!/usr/bin/env bash
# The voice-over, one line per part (§240): Microsoft's neural "Asilia"
# (Kenyan English), the voice the user chose from five samples. Needs
# `pip install edge-tts`. Change a line here and run again; compose.py fits
# each step's picture to its line.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p voice
V=en-KE-AsiliaNeural
say() { edge-tts --voice "$V" --rate=-4% --text "$2" --write-media "voice/$1.mp3"; echo "voice/$1.mp3"; }
say 0-intro "Booking an appointment on Bwangu Reservations takes under a minute. Here is how."
say 1-find  "First, find a shop near you. Search for what you need, or pick a place you know."
say 2-time  "Choose a service, pick a day, and tap a free time. You see what is open right now, from morning to evening."
say 3-pay   "Hold your time with a small deposit, paid with MTN Mobile Money. Approve it on your phone, and you are booked."
say 4-code  "You get a six digit code. Show it at the door, and the shop checks you in. No password, no printout."
say 5-outro "Bwangu Reservations. Your appointments, without the phone calls."
