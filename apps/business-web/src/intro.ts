/**
 * The opening picture (§302) is drawn by the page itself (`index.html`), so
 * it plays while the app loads rather than after. This takes it away once the
 * app has drawn:
 *
 * - in full the first time in a while: once the picture is complete, the
 *   paper hill rises over everything and becomes the app's background;
 * - otherwise (a reload, another tab the same day) straight away, with a
 *   plain fade. The picture is a welcome, never a wait — least of all in a
 *   tool somebody opens all day.
 *
 * A tap or a key ends the wait early. The customer app's web does the same
 * (`apps/customer-app/src/ui/webIntro.ts`).
 */

const SEEN_AT = 'booking-business.introSeenAt';
/** How long one full welcome lasts: a working day gets one. */
const FULL_EVERY = 12 * 60 * 60 * 1000;
/** The longest the picture is waited for, whatever the browser reports. */
const LONGEST = 2400;
/** For a browser that cannot say when the animations end: about when they do. */
const USUAL = 1800;
const PORCELAIN = '#F9F8F6';

let leaving: Promise<void> | null = null;

export function leaveIntro(): Promise<void> {
  leaving ??= leave();
  return leaving;
}

async function leave() {
  const intro = document.getElementById('intro');
  if (!intro) return;
  const full = welcomeDue();
  if (full) await complete(intro);
  document.documentElement.classList.add('intro-gone');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PORCELAIN);
  intro.classList.add(full ? 'in-leave' : 'in-quick');
  await new Promise((resolve) => setTimeout(resolve, full ? 700 : 260));
  intro.remove();
}

/** Whether the full picture is due, and noting that it has now been seen. */
function welcomeDue(): boolean {
  try {
    const last = Number(localStorage.getItem(SEEN_AT)) || 0;
    const due = Date.now() - last > FULL_EVERY;
    if (due) localStorage.setItem(SEEN_AT, String(Date.now()));
    return due;
  } catch {
    // Storage blocked: there is no telling, so no waiting.
    return false;
  }
}

/**
 * When the picture's entrance has played. The rings are left out: they keep
 * pulsing for as long as the app is still loading.
 */
function complete(intro: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      intro.removeEventListener('pointerdown', done);
      window.removeEventListener('keydown', done);
      resolve();
    };
    const told = 'getAnimations' in intro;
    const timer = setTimeout(done, told ? LONGEST : USUAL);
    intro.addEventListener('pointerdown', done);
    window.addEventListener('keydown', done);
    if (!told) return;
    const entrance = intro
      .getAnimations({ subtree: true })
      .filter((animation) => !/^in-(ring|wait)$/.test((animation as CSSAnimation).animationName ?? ''));
    void Promise.all(entrance.map((animation) => animation.finished.catch(() => undefined))).then(done);
  });
}
