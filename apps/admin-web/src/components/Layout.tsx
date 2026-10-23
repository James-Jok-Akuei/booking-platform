import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveNotifications } from '../notify/useLive';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { CommandPalette } from '../shell/CommandPalette';
import { MenuDrawer, Sidebar } from '../shell/Sidebar';
import { Topbar } from '../shell/Topbar';
import { useMediaQuery } from '../shell/useMediaQuery';
import { useShellData } from '../shell/useShellData';
import { confirmDialog } from '../ui/Dialog';
import '../shell/shell.css';
import { PageCrash } from '../ui/PageCrash';

const RAIL_KEY = 'booking-admin.sidebar-rail';

const readRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

/** True while someone is typing, so a single-key shortcut does not steal the key. */
const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

/**
 * The frame around every page (§131, §242) — the business app's (§190): the
 * sidebar, the top bar, and on a phone the menu drawer. The twelve pages are
 * unchanged and render in the middle.
 */
export function Layout() {
  const { signOut } = useAuth();
  // The bell, live (§287).
  useLiveNotifications(true);
  const navigate = useNavigate();
  const location = useLocation();
  const data = useShellData();

  const [rail, setRail] = useState(readRail);
  // A tablet is always the rail: a full sidebar would leave the page too narrow.
  const tablet = useMediaQuery('(min-width: 860px) and (max-width: 1199px)');
  const folded = rail || tablet;
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  // Once the page moves under the top bar, the bar gets an edge — and on a
  // phone, the page's name, which has scrolled out of view.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  // Page headers pin right under the top bar, however tall it is (§209, §214):
  // the bar's height goes into --tb-h; a tall header pins from its `.pin-from`
  // row (on a phone, its `.pin-phone` row, or its first row after the title),
  // the part above scrolling away under the bar. A header never changes size
  // as the page scrolls — that once made the page fight the scroll.
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = main.current;
    const bar = box?.querySelector<HTMLElement>('.topbar');
    if (!box || !bar) return;
    const phone = window.matchMedia('(max-width: 859px)');
    const watched = new Set<Element>();
    const set = (el: HTMLElement, name: string, value: string) => {
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    };
    const measureNow = () => {
      set(box, '--tb-h', `${bar.offsetHeight}px`);
      const content = box.querySelector<HTMLElement>('.content');
      const top = content?.querySelector<HTMLElement>('.page-top');
      for (const el of [content, top]) {
        if (el && !watched.has(el)) {
          watched.add(el);
          watch.observe(el);
        }
      }
      if (!top) return;
      const pin = phone.matches
        ? top.querySelector<HTMLElement>('.pin-phone') ??
          top.querySelector<HTMLElement>(':scope > .pin-from') ??
          top.querySelector<HTMLElement>(':scope > :nth-child(2)')
        : top.querySelector<HTMLElement>(':scope > .pin-from');
      const fold = pin
        ? Math.max(0, pin.getBoundingClientRect().top - top.getBoundingClientRect().top - 10)
        : phone.matches
          ? top.offsetHeight
          : 0;
      set(top, '--pt-fold', `${Math.round(fold)}px`);
    };
    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measureNow();
      });
    };
    const watch = new ResizeObserver(measure);
    watch.observe(bar);
    const swap = new MutationObserver(measure);
    swap.observe(box, { childList: true, subtree: true });
    phone.addEventListener('change', measure);
    measureNow();
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      swap.disconnect();
      phone.removeEventListener('change', measure);
    };
  }, []);

  const toggleRail = () =>
    setRail((was) => {
      try {
        localStorage.setItem(RAIL_KEY, was ? '0' : '1');
      } catch {
        // Private mode: the fold just is not remembered.
      }
      return !was;
    });

  // Signing out asks first (§226): every way out comes through here.
  const leave = useCallback(async () => {
    const sure = await confirmDialog({
      title: 'Sign out?',
      body: (
        <p>
          You will leave the admin console on this device. To come back, sign in with your email and the new
          6-digit code we send you.
        </p>
      ),
      icon: 'logout',
      tone: 'warn',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
    });
    if (!sure) return;
    await signOut();
    navigate('/login', { replace: true });
  }, [navigate, signOut]);

  const closePalette = useCallback(() => setPalette(false), []);

  // A new page closes the phone's menu.
  useEffect(() => setDrawer(false), [location.pathname]);

  // ⌘K / Ctrl K anywhere, and "/" when not typing, open the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((was) => !was);
      } else if (event.key === '/' && !typing(event.target)) {
        event.preventDefault();
        setPalette(true);
      }
    };
    // A page may ask for the search too — the not-found page's "Search every page" (§311).
    const onAsk = () => setPalette(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('app:search', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('app:search', onAsk);
    };
  }, []);

  return (
    <div className={`app${folded ? ' has-rail' : ''}${scrolled ? ' is-scrolled' : ''}`}>
      <div className="app-side">
        <Sidebar data={data} rail={folded} onToggleRail={tablet ? undefined : toggleRail} onSignOut={leave} />
      </div>

      <div className="app-main" ref={main}>
        <Topbar
          data={data}
          scrolled={scrolled}
          onOpenMenu={() => setDrawer(true)}
          onOpenSearch={() => setPalette(true)}
          onSignOut={leave}
        />
        <main className="content" key={location.pathname}>
          <PageCrash>
            <Outlet />
          </PageCrash>
        </main>
      </div>

      {drawer && <MenuDrawer data={data} onClose={() => setDrawer(false)} onSignOut={leave} />}
      {palette && <CommandPalette onClose={closePalette} onSignOut={leave} />}
    </div>
  );
}
