"""Compose the "how booking works" video (§240) from the phone recordings,
the voice lines and the brand: a dark canvas, the phone on the right, the
step's title and caption on the left, the four steps as bars along the foot,
a ripple where a finger taps.

  python compose.py <recording> <out.mp4> [<recording of the code screen>]

Steps 1–3 come from the first recording (STEP marks in its log), step 4 from
the second. STEP3_STOP=<seconds> ends step 3 early — a moment after
"Payment successful" — rather than at the recording's end.
"""
import json, math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
REC, OUT = sys.argv[1], sys.argv[2]
W, H, FPS = 1920, 1080, 30
INK, DARK, ORANGE, CREAM = (31, 42, 31), (30, 38, 30), (253, 117, 17), (251, 246, 236)
FF = imageio_ffmpeg.get_ffmpeg_exe()
F = lambda w, size: ImageFont.truetype(f'{HERE}/fonts/PlusJakartaSans-{w}.ttf', size)

def audio_len(path):
    out = subprocess.run([FF, '-i', path], capture_output=True, text=True).stderr
    h, m, s = out.split('Duration: ')[1].split(',')[0].split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)

# ---- what each part says ---------------------------------------------------
STEPS = {
    1: ('Find a shop near you', 'Real photos, prices and opening hours.', f'{HERE}/voice/1-find.mp3'),
    2: ('Pick a service and a time', 'Days and free times, at a glance.', f'{HERE}/voice/2-time.mp3'),
    3: ('Hold it with a small deposit', 'Paid with MTN MoMo, approved on your phone.', f'{HERE}/voice/3-pay.mp3'),
    4: ('Show your code at the door', 'Six digits. The shop checks you in.', f'{HERE}/voice/4-code.mp3'),
}
INTRO_VOICE, OUTRO_VOICE = f'{HERE}/voice/0-intro.mp3', f'{HERE}/voice/5-outro.mp3'

# ---- the recordings ---------------------------------------------------------
# Steps 1–3 come from the main recording; the confirmed reservation with the
# code (step 4) from a second, short one, since it is one tap further on.
REC4 = sys.argv[3] if len(sys.argv) > 3 else REC

def load(rec):
    log = json.load(open(f'{rec}/log.json'))
    t0 = log['frames'][0]['t']
    times = [f['t'] - t0 for f in log['frames']]
    marks = [(m['t'] - t0, m['text']) for m in log['marks']]
    return {
        'dir': rec, 'times': times,
        'step_at': {int(t.split()[1]): at for at, t in marks if t.startswith('STEP')},
        'end_at': next((at for at, t in marks if t == 'END'), times[-1]),
        'taps': [(at, int(t.split()[1]), int(t.split()[2])) for at, t in marks if t.startswith('TAP')],
    }

RECS = {REC: load(REC)}
if REC4 != REC: RECS[REC4] = load(REC4)
step_at = RECS[REC]['step_at']
end_at = RECS[REC]['end_at']

def frame_index(rec, rec_t):
    times = RECS[rec]['times']
    lo, hi = 0, len(times) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if times[mid] <= rec_t: lo = mid
        else: hi = mid - 1
    return lo

# ---- the shots: intro, four steps, outro ------------------------------------
shots = []
intro_len = audio_len(INTRO_VOICE)
shots.append({'kind': 'intro', 'dur': intro_len + 1.0, 'voice': (INTRO_VOICE, 0.6)})
# Step 3 ends on the "Payment successful" screen, a second after it settles.
STEP3_STOP = float(os.environ.get('STEP3_STOP', '0')) or None
for n in (1, 2, 3, 4):
    rec = REC4 if (n == 4 and REC4 != REC) else REC
    if n == 4 and REC4 != REC:
        start, stop = RECS[REC4]['step_at'].get(4, 0.0), RECS[REC4]['end_at']
    else:
        start = step_at[n]
        stop = STEP3_STOP if (n == 3 and STEP3_STOP) else step_at.get(n + 1, end_at)
    recorded = stop - start
    voice = STEPS[n][2]
    need = audio_len(voice) + 1.1
    # Slow the recording down to fit the voice, down to 0.62×; past that, hold the last frame.
    speed = min(1.0, max(0.62, recorded / need))
    dur = max(recorded / speed, need)
    shots.append({'kind': 'step', 'n': n, 'rec': rec, 'dur': dur, 'start': start, 'stop': stop, 'speed': speed, 'voice': (voice, 0.35)})
outro_len = audio_len(OUTRO_VOICE)
shots.append({'kind': 'outro', 'dur': outro_len + 1.2, 'voice': (OUTRO_VOICE, 0.5)})
total = sum(s['dur'] for s in shots)
print('shots', [(s['kind'], round(s['dur'], 1), round(s.get('speed', 1), 2)) for s in shots], 'total', round(total, 1))

# ---- drawing ---------------------------------------------------------------
def bezier(p0, p1, p2, p3, n=40):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]

def stroke(draw, pts, width, color):
    draw.line(pts, fill=color, width=width, joint='curve')
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

def logo(size):
    """The mark: a white tile, the "b" in ink, the check in orange."""
    s = 4  # drawn big, shrunk for smooth edges
    S = size * s
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 32 / 136, fill=(255, 255, 255, 255))
    u = S / 136
    P = lambda x, y: ((20 + 0.8 * x) * u, (20 + 0.8 * y) * u)
    b = bezier(P(30, 18), P(28, 40), P(27, 62), P(29, 88)) + bezier(P(29, 88), P(31, 100), P(40, 106), P(50, 104)) + bezier(P(50, 104), P(66, 100), P(74, 86), P(70, 70)) + bezier(P(70, 70), P(66, 58), P(50, 54), P(36, 64))
    stroke(d, b, int(9 * 0.8 * u), INK + (255,))
    stroke(d, [P(72, 70), P(82, 82), P(106, 46)], int(9 * 0.8 * u), ORANGE + (255,))
    return im.resize((size, size), Image.LANCZOS)

def wordmark(draw, x, y, size, light=True):
    f = F(800, size)
    draw.text((x, y), 'Bwangu', font=f, fill=(255, 255, 255) if light else INK)
    w = draw.textlength('Bwangu', font=f)
    draw.text((x + w, y), 'Reservations', font=f, fill=ORANGE)

def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        trial = (line + ' ' + w).strip()
        if draw.textlength(trial, font=font) <= width: line = trial
        else: lines.append(line); line = w
    if line: lines.append(line)
    return lines

def background():
    im = Image.new('RGB', (W, H), DARK)
    glow = Image.new('RGB', (W, H), DARK)
    g = ImageDraw.Draw(glow)
    g.ellipse([-500, -300, 700, 900], fill=(44, 56, 44))
    g.ellipse([1300, 500, 2500, 1700], fill=(40, 50, 40))
    g.ellipse([900, -600, 2400, 500], fill=(38, 48, 38))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    im = Image.blend(im, glow, 0.9)
    im.paste(logo(56), (96, 56), logo(56))
    wordmark(ImageDraw.Draw(im), 170, 60, 34)
    return im

BG = background()
PHONE_S = 0.56
PW, PH = int(780 * PHONE_S), int(1688 * PHONE_S)
PX, PY = 1330, 62
BEZEL = 16
screen_mask = Image.new('L', (PW, PH), 0)
ImageDraw.Draw(screen_mask).rounded_rectangle([0, 0, PW - 1, PH - 1], radius=46, fill=255)
bezel = Image.new('RGBA', (PW + BEZEL * 2 + 60, PH + BEZEL * 2 + 60), (0, 0, 0, 0))
shadow = Image.new('RGBA', bezel.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([30, 46, PW + BEZEL * 2 + 30, PH + BEZEL * 2 + 46], radius=62, fill=(0, 0, 0, 150))
shadow = shadow.filter(ImageFilter.GaussianBlur(28))
bezel.alpha_composite(shadow)
ImageDraw.Draw(bezel).rounded_rectangle([30, 30, PW + BEZEL * 2 + 30, PH + BEZEL * 2 + 30], radius=62, fill=(15, 20, 15, 255), outline=(255, 255, 255, 40), width=2)

def phone_layer(base, rec, rec_t, t_in):
    i = frame_index(rec, rec_t)
    shot = Image.open(f'{rec}/frames/{i:05d}.jpg').convert('RGB').resize((PW, PH), Image.BILINEAR)
    base.alpha_composite(bezel, (PX - BEZEL - 30, PY - BEZEL - 30))
    base.paste(shot, (PX, PY), screen_mask)
    # A ripple where a finger tapped, for half a second after.
    for at, x, y in RECS[rec]['taps']:
        dt = rec_t - at
        if 0 <= dt < 0.5:
            k = dt / 0.5
            cx, cy = PX + x * 2 * PHONE_S, PY + y * 2 * PHONE_S
            r = 12 + 34 * k
            ring = Image.new('RGBA', base.size, (0, 0, 0, 0))
            rd = ImageDraw.Draw(ring)
            rd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ORANGE + (int(230 * (1 - k)),), width=5)
            rd.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=ORANGE + (int(200 * (1 - k)),))
            base.alpha_composite(ring)

def text_layer(base, n, t_in, dur):
    title, caption, _ = STEPS[n]
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = min(1.0, t_in / 0.45)
    rise = int((1 - a) * 18)
    y = 330 + rise
    pill = F(700, 22)
    label = f'STEP {n} OF 4'
    pw = d.textlength(label, font=pill) + 44
    d.rounded_rectangle([110, y, 110 + pw, y + 44], radius=22, fill=ORANGE + (int(255 * a),))
    d.text((132, y + 10), label, font=pill, fill=INK + (int(255 * a),))
    y += 76
    for line in wrap(d, title, F(800, 76), 900):
        d.text((110, y), line, font=F(800, 76), fill=(255, 255, 255, int(255 * a)))
        y += 88
    y += 18
    for line in wrap(d, caption, F(500, 36), 900):
        d.text((112, y), line, font=F(500, 36), fill=CREAM + (int(215 * a),))
        y += 48
    # The four steps, as bars along the foot; this one filling.
    bx, bw, gap = 110, 150, 14
    for k in range(1, 5):
        x = bx + (k - 1) * (bw + gap)
        d.rounded_rectangle([x, 992, x + bw, 998], radius=3, fill=(255, 255, 255, 50))
        fill = bw if k < n else (bw * min(1.0, t_in / dur) if k == n else 0)
        if fill: d.rounded_rectangle([x, 992, x + fill, 998], radius=3, fill=ORANGE + (255,))
    base.alpha_composite(layer)

def intro_frame(t, dur):
    im = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(im)
    a = min(1.0, t / 0.6)
    fade = 1.0 if t < dur - 0.5 else max(0.0, (dur - t) / 0.5)
    k = int(255 * a * fade)
    lg = logo(150)
    lg.putalpha(lg.getchannel('A').point(lambda v: int(v * a * fade)))
    im.alpha_composite(lg, (W // 2 - 75, 300))
    f = F(800, 92)
    title = 'How booking works'
    d.text((W // 2 - d.textlength(title, font=f) / 2, 500), title, font=f, fill=(255, 255, 255, k))
    f2 = F(500, 38)
    sub = 'Under a minute, from your phone.'
    d.text((W // 2 - d.textlength(sub, font=f2) / 2, 626), sub, font=f2, fill=CREAM + (int(215 * a * fade),))
    return im.convert('RGB')

def outro_frame(t, dur):
    im = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(im)
    a = min(1.0, t / 0.6)
    k = int(255 * a)
    lg = logo(130)
    lg.putalpha(lg.getchannel('A').point(lambda v: int(v * a)))
    im.alpha_composite(lg, (W // 2 - 65, 290))
    f = F(800, 84)
    w1 = d.textlength('Bwangu', font=f); w2 = d.textlength('Reservations', font=f)
    x = W // 2 - (w1 + w2) / 2
    d.text((x, 470), 'Bwangu', font=f, fill=(255, 255, 255, k))
    d.text((x + w1, 470), 'Reservations', font=f, fill=ORANGE + (k,))
    f2 = F(500, 40)
    line = 'Your appointments, without the phone calls.'
    d.text((W // 2 - d.textlength(line, font=f2) / 2, 592), line, font=f2, fill=CREAM + (int(215 * a),))
    f3 = F(700, 30)
    label = 'Get the app'
    pw = d.textlength(label, font=f3) + 72
    d.rounded_rectangle([W // 2 - pw / 2, 690, W // 2 + pw / 2, 760], radius=16, fill=ORANGE + (k,))
    d.text((W // 2 - pw / 2 + 36, 707), label, font=f3, fill=INK + (k,))
    return im.convert('RGB')

def step_frame(shot, t):
    im = BG.copy().convert('RGBA')
    rec_t = min(shot['stop'] - 0.01, shot['start'] + t * shot['speed'])
    phone_layer(im, shot['rec'], rec_t, t)
    text_layer(im, shot['n'], t, shot['dur'])
    return im.convert('RGB')

# ---- the sound: each line where its part begins ----------------------------
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
inputs, filters, labels, at = [], [], [], 0.0
for i, s in enumerate(shots):
    path, lead = s['voice']
    inputs += ['-i', path]
    filters.append(f'[{i}]adelay={int((at + lead) * 1000)}|{int((at + lead) * 1000)}[a{i}]')
    labels.append(f'[a{i}]')
    at += s['dur']
mix = ''.join(labels) + f'amix=inputs={len(shots)}:normalize=0,apad,atrim=0:{total:.2f}[out]'
audio = OUT.replace('.mp4', '-audio.m4a')
subprocess.run([FF, '-y', *inputs, '-filter_complex', ';'.join(filters) + ';' + mix, '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', audio], check=True, capture_output=True)

# ---- the picture, frame by frame into ffmpeg -------------------------------
enc = subprocess.Popen([FF, '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', audio,
                        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                        '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
poster = None
n_total = int(total * FPS)
for k in range(n_total):
    t = k / FPS
    acc = 0.0
    for s in shots:
        if t < acc + s['dur'] or s is shots[-1]:
            tin = t - acc
            im = intro_frame(tin, s['dur']) if s['kind'] == 'intro' else outro_frame(tin, s['dur']) if s['kind'] == 'outro' else step_frame(s, tin)
            if poster is None and s['kind'] == 'step' and tin > 1.0: poster = im.copy()
            break
        acc += s['dur']
    enc.stdin.write(im.tobytes())
    if k % 300 == 0: print(f'{k}/{n_total}', flush=True)
enc.stdin.close(); enc.wait()
if poster: poster.save(OUT.replace('.mp4', '-poster.jpg'), quality=85, optimize=True)
print('done', OUT, os.path.getsize(OUT) // 1024, 'KB')
