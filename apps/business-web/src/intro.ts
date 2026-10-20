/**
 * The opening picture (§302) is drawn by the page itself (`index.html`), so
 * it plays while the app loads rather than after. This takes it away once the
 * app has drawn — and once the picture is complete, every time the page
 * opens, as the phone's plays every time the app starts (§302.6): the night
 * lifts away like a curtain and the app is underneath.
 *
 * A click, a tap or a key ends the wait early; with "reduce motion" the still
 * picture simply fades. The customer app's web does the same
 * (`apps/customer-app/src/ui/webIntro.ts`).
 */

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
  // "Reduce motion": the picture was still, so it goes without moving too.
  const full = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (full) await complete(intro);
  document.documentElement.classList.add('intro-gone');
  intro.classList.add(full ? 'in-leave' : 'in-quick');
  await new Promise((resolve) => setTimeout(resolve, full ? 660 : 260));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PORCELAIN);
  intro.remove();
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
