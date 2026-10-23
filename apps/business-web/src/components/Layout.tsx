import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageCrash } from '../ui/PageCrash';
import { AdRail } from '../ads/AdRail';
import { AdStrip } from '../ads/AdStrip';
import { useAuth } from '../auth/auth-context';
import { CheckInProvider, useCheckIn } from '../checkin/CheckIn';
import { CommandPalette } from '../shell/CommandPalette';
import { MenuDrawer, TabBar } from '../shell/MobileNav';
import { Sidebar } from '../shell/Sidebar';
import { Topbar } from '../shell/Topbar';
import { useMediaQuery } from '../shell/useMediaQuery';
import { useShellData } from '../shell/useShellData';
import { confirmDialog } from '../ui/Dialog';
import { LegalBanner } from './LegalGate';
import { NoticeBanner } from '../shell/NoticeBanner';
import { useLiveNotifications } from '../notify/useLive';
import { turnOffHere } from '../notify/webPush';
import { TourProvider } from '../tour/Tour';
import '../shell/shell.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

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
      {/* The welcome tour (§307), offered once to somebody new, kept in Help. */}
      <TourProvider>
        <Frame />
      </TourProvider>
    </CheckInProvider>
  );
}

function Frame() {
  const { signOut, user } = useAuth();
  // The bell, live (§287).
  useLiveNotifications(Boolean(user));
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
    if (!box || !bar) return;
    const phone = window.matchMedia('(max-width: 859px)');
    // Found afresh each time: the page area is replaced on every page change,
    // and a page draws its header only once its data has come (§217).
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
      // A little glass is left above the pinned row.
      const fold = pin
        ? Math.max(0, pin.getBoundingClientRect().top - top.getBoundingClientRect().top - 10)
        : phone.matches
          ? top.offsetHeight
          : 0;
      set(top, '--pt-fold', `${Math.round(fold)}px`);
    };
    // At most once a frame, however many changes arrive together.
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
    // A new page area, or a header that appears inside it.
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

  // Signing out asks first (§226): the icon sits beside the account, easy to
  // press by mistake, and coming back means a new code by email. Every way out
  // — the sidebar, the shop menu, the phone's menu, search — comes through here.
  const leave = useCallback(async () => {
    const shopName = data.business?.name;
    const sure = await confirmDialog({
      title: t`Sign out?`,
      body: (
        <p>
          {shopName ? (
            <Trans>
              You will leave <strong>{shopName}</strong> on this device. To come back, sign in with your email and the
              new 6-digit code we send you.
            </Trans>
          ) : (
            <Trans>
              You will leave your business on this device. To come back, sign in with your email and the new 6-digit
              code we send you.
            </Trans>
          )}
        </p>
      ),
      icon: 'logout',
      tone: 'warn',
      confirmLabel: t`Sign out`,
      cancelLabel: t`Stay signed in`,
    });
    if (!sure) return;
    // This computer stops getting this account's alerts (§287).
    await turnOffHere();
    await signOut();
    navigate('/login', { replace: true });
  }, [navigate, signOut, data.business?.name]);

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
          <NoticeBanner />
          {/* No room for the "For you" column: a slim banner opens every page
              but Overview, which has its own (§221). */}
          {!wide && location.pathname !== '/' && <AdStrip />}
          <PageCrash>
            <Outlet />
          </PageCrash>
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
