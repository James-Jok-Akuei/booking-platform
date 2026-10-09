(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mark = (text) => console.log(text);
  const clickable = (el) => el.closest('[role="button"],[tabindex],a,button') || el;
  const byText = (text, exact = false) =>
    [...document.querySelectorAll('div,span,a,button')].filter((d) => {
      const t = d.textContent.trim();
      return d.children.length <= 2 && (exact ? t === text : t.startsWith(text)) && d.getBoundingClientRect().height > 0;
    });
  const tap = async (el, settle = 900) => {
    const r = el.getBoundingClientRect();
    mark(`TAP ${Math.round(r.left + r.width / 2)} ${Math.round(r.top + r.height / 2)}`);
    await wait(120);
    el.click();
    await wait(settle);
  };
  const untilText = async (text, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const hits = byText(text);
      if (hits.length) return hits[0];
      await wait(250);
    }
    throw new Error('never saw: ' + text);
  };
  const type = async (input, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    for (let i = 1; i <= text.length; i++) {
      setter.call(input, text.slice(0, i));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(110 + Math.random() * 60);
    }
  };

  // The developer warning box, removed whenever it appears.
  const killToast = () => {
    const found = [];
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
        if (el.children.length === 0 && /cannot contain|cannot be a descendant|Warning:/.test(el.textContent || '')) found.push(el);
      }
    };
    walk(document);
    for (const el of found) {
      let host = el;
      while (host.parentElement && host.parentElement.getBoundingClientRect().height < 160) host = host.parentElement;
      host.remove();
    }
  };
  killToast();
  const sweeper = setInterval(killToast, 400);

  // ---- 1. Find a shop
  mark('STEP 1');
  await wait(1200);
  const search = document.querySelector('input[placeholder="Search a shop or a service"]');
  await tap(search, 400);
  await type(search, 'spa');
  await wait(1400);
  const spa = clickable(await untilText('Kimironko Spa'));
  await tap(spa, 2600);

  // ---- 2. Pick a service and a time
  mark('STEP 2');
  window.scrollTo({ top: 280, behavior: 'smooth' });
  await wait(1100);
  const steam = clickable(await untilText('Steam room'));
  await tap(steam, 2400);
  // The days strip: the third day from today.
  const days = [...document.querySelectorAll('[aria-label]')].filter((d) => /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w+$/.test(d.getAttribute('aria-label') || '') && d.getBoundingClientRect().height > 0);
  const day = days[3] || days[1] || days[0];
  day.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await wait(900);
  await tap(day, 1500);
  let slot = null;
  for (let i = 0; i < 20 && !slot; i++) {
    slot = [...document.querySelectorAll('[aria-label]')].find((d) => /^\d\d:\d\d$/.test(d.getAttribute('aria-label') || '') && d.getAttribute('aria-disabled') !== 'true' && d.getBoundingClientRect().height > 0);
    if (!slot) await wait(300);
  }
  slot.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await wait(900);
  await tap(slot, 1200);
  const book = clickable(await untilText('Book '));
  await tap(book, 3200);

  // ---- 3. Hold it with a deposit
  mark('STEP 3');
  await untilText('Pay now');
  await wait(600);
  const saved = byText('07').find((d) => /^0\d{2}/.test(d.textContent.trim()));
  if (saved) await tap(clickable(saved), 900);
  else await type(document.querySelector('input[placeholder="07xx xxx xxx"]'), '0788123456');
  // The orange button, not the words in the summary: of the leaves that say
  // exactly "Pay now", the one lowest and furthest right on the screen.
  const payButtons = () =>
    byText('Pay now', true)
      .filter((d) => d.children.length === 0)
      .sort((a, b) => (b.getBoundingClientRect().top + b.getBoundingClientRect().left) - (a.getBoundingClientRect().top + a.getBoundingClientRect().left));
  let payBtn = payButtons()[0];
  for (let i = 0; i < 20 && !payBtn; i++) { await wait(300); payBtn = payButtons()[0]; }
  payBtn = payBtn.closest('[tabindex],[role="button"],button') || payBtn;
  mark('NOTE pay via ' + payBtn.tagName + ' ' + (payBtn.getAttribute('role') || '') + ' ' + Math.round(payBtn.getBoundingClientRect().top));
  payBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await wait(800);
  await tap(payBtn, 1200);
  mark('NOTE waiting for the sandbox');
  // The sandbox approves within a few seconds; the app polls every four.
  let code = null;
  for (let i = 0; i < 90 && !code; i++) {
    code = [...document.querySelectorAll('div,span')].find((d) => d.children.length === 0 && /^\d{3}\s?\d{3}$|^\d{6}$|^\d \d \d \d \d \d$/.test(d.textContent.trim()) && d.getBoundingClientRect().height > 0);
    if (!code) await wait(500);
  }

  // ---- 4. The code
  mark('STEP 4');
  await wait(1500);
  if (code) { code.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  await wait(3200);
  mark('END');
  clearInterval(sweeper);
  return 'done, code ' + (code ? code.textContent.trim() : 'not seen') + ' at ' + location.pathname;
})()
