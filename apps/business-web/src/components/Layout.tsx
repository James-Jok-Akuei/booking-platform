import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AdRail } from '../ads/AdRail';
import { useAuth } from '../auth/auth-context';
import { CheckInProvider, useCheckIn } from '../checkin/CheckIn';
import { CommandPalette } from '../shell/CommandPalette';
import { MenuDrawer, TabBar } from '../shell/MobileNav';
import { Sidebar } from '../shell/Sidebar';
import { Topbar } from '../shell/Topbar';
import { useMediaQuery } from '../shell/useMediaQuery';
import { useShellData } from '../shell/useShellData';
import { LegalBanner } from './LegalGate';
import '../shell/shell.css';

const RAIL_KEY = 'booking-business.sidebar-rail';
const ADS_KEY = 'booking-business.ads-folded';

const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Private mode: the choice just is not remembered.
  }
};

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
 * The frame around every page (§131, §190): the sidebar, the top bar, and on a
 * phone the tab bar and the menu drawer. The pages themselves are unchanged
 * and render in the middle, under the legal banner when something needs
 * agreeing to (§126.3).
 */
export function Layout() {
  return (
    <CheckInProvider>
      <Frame />
    </CheckInProvider>
  );
}

function Frame() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const data = useShellData();

  const [rail, setRail] = useState(readRail);
  // A tablet is always the rail: a full sidebar would leave the page too narrow.
  const tablet = useMediaQuery('(min-width: 860px) and (max-width: 1199px)');
  const folded = rail || tablet;
  // "For you" down the right (§204), where there is room for a third column.
  const wide = useMediaQuery('(min-width: 1280px)');
  const [adsFolded, setAdsFolded] = useState(() => readFlag(ADS_KEY));
  const toggleAds = () =>
    setAdsFolded((was) => {
      writeFlag(ADS_KEY, !was);
      return !was;
    });
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

  // The pinned headers sit right under the top bar, however tall it is
  // (§209, §214). A header never changes size as the page scrolls — that
  // made the browser shift the page to make up for it, which unfolded the
  // header again, and the two fought the scroll. Instead, the part of a
  // header above its `.pin-from` row (on a phone: above its `.pin-phone`
  // row, or its first row after the title) simply scrolls away under the
  // bar, and the rest stays.
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = main.current;
    const bar = box?.querySelector<HTMLElement>('.topbar');
    const content = box?.querySelector<HTMLElement>('.content');
    if (!box || !bar || !content) return;
    const phone = window.matchMedia('(max-width: 859px)');
    let watched: HTMLElement | null = null;
    const measure = () => {
      box.style.setProperty('--tb-h', `${bar.offsetHeight}px`);
      const top = content.querySelector<HTMLElement>('.page-top');
      if (top && top !== watched) {
        watched = top;
        watch.observe(top);
      }
      if (!top) return;
      const pin = phone.matches
        ? top.querySelector<HTMLElement>('.pin-phone') ??
          top.querySelector<HTMLElement>(':scope > .pin-from') ??
          top.querySelector<HTMLElement>(':scope > :nth-child(2)')
        : top.querySelector<HTMLElement>(':scope > .pin-from');
      // A little glass is left above the pinned row.
      const fold = pin
        ? Math.max(0, pin.getBoundingClientRect().top - top.getBoundingClientRect().top - 10)
        : phone.matches
          ? top.offsetHeight
          : 0;
      top.style.setProperty('--pt-fold', `${Math.round(fold)}px`);
    };
    const watch = new ResizeObserver(measure);
    watch.observe(bar);
    watch.observe(content);
    phone.addEventListener('change', measure);
    measure();
    return () => {
      watch.disconnect();
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

  const leave = useCallback(async () => {
    await signOut();
    navigate('/login', { replace: true });
  }, [navigate, signOut]);

  // Checking someone in has its own window (§191), from anywhere.
  const openCheckIn = useCheckIn();
  const checkIn = useCallback(() => openCheckIn(), [openCheckIn]);
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`app${folded ? ' has-rail' : ''}${wide ? ' has-ads' : ''}${wide && adsFolded ? ' ads-folded' : ''}${scrolled ? ' is-scrolled' : ''}`}
    >
      <div className="app-side">
        <Sidebar
          data={data}
          rail={folded}
          onToggleRail={tablet ? undefined : toggleRail}
          onSignOut={leave}
        />
      </div>

      <div className="app-main" ref={main}>
        <Topbar
          data={data}
          scrolled={scrolled}
          onOpenMenu={() => setDrawer(true)}
          onOpenSearch={() => setPalette(true)}
          onCheckIn={checkIn}
          onSignOut={leave}
        />
        <main className="content" key={location.pathname}>
          <LegalBanner />
          <Outlet />
        </main>
      </div>

      {wide && (
        <div className="app-ads">
          <AdRail folded={adsFolded} onFold={toggleAds} />
        </div>
      )}

      <TabBar data={data} onCheckIn={checkIn} onOpenMenu={() => setDrawer(true)} />

      {drawer && <MenuDrawer data={data} onClose={() => setDrawer(false)} onSignOut={leave} />}
      {palette && <CommandPalette onClose={closePalette} onCheckIn={checkIn} onSignOut={leave} />}
    </div>
  );
}
