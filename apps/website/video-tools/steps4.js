(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mark = (text) => console.log(text);
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
  mark('STEP 4');
  await wait(2200);
  let code = null;
  for (let i = 0; i < 20 && !code; i++) {
    code = [...document.querySelectorAll('div,span')].find((d) => d.children.length === 0 && /^\d{6}$|^\d{3}\s?\d{3}$|^\d \d \d \d \d \d$/.test(d.textContent.trim()) && d.getBoundingClientRect().height > 0);
    if (!code) await wait(300);
  }
  if (code) code.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else window.scrollBy({ top: 420, behavior: 'smooth' });
  await wait(4200);
  mark('END');
  clearInterval(sweeper);
  return 'code ' + (code ? code.textContent.trim() : 'not seen') + ' y ' + (code ? Math.round(code.getBoundingClientRect().top) : -1);
})()
