# The walkthrough video

`public/video/how-booking-works.mp4` — a minute of the real customer app
booking a steam room, with a voice over each step (§240). It is made, not
edited: `make.sh` records the running app with a script that taps through it,
records the confirmed reservation, and composes both with the voice lines.

Run it again whenever the customer app's screens change, so the video never
shows an app that no longer exists:

```
cd apps/website/video-tools
python3 -m venv .venv && .venv/bin/pip install pillow imageio-ffmpeg edge-tts
# token.json: the customer app's sign-in — see make.sh
./make.sh
```

- `rec.mjs` — records a page frame by frame while `steps.js` taps through
  the booking; `steps4.js` opens the confirmed reservation.
- `voices.sh` — the six voice lines (Microsoft's "Asilia", Kenyan English).
- `compose.py` — the canvas, the phone, the titles, the bars, the sound.
- `fonts/` — Plus Jakarta Sans (OFL), for the titles.
