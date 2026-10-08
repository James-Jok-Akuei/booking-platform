import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { CommandPalette } from '../shell/CommandPalette';
import { MenuDrawer, TabBar } from '../shell/MobileNav';
import { Sidebar } from '../shell/Sidebar';
import { Topbar } from '../shell/Topbar';
import { useMediaQuery } from '../shell/useMediaQuery';
import { useShellData } from '../shell/useShellData';
import { LegalBanner } from './LegalGate';
import '../shell/shell.css';

const RAIL_KEY = 'booking-business.sidebar-rail';

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
  const { signOut } = useAuth();
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

  // Checking a customer in happens on Appointments, where each expected
  // customer has their code box.
  const checkIn = useCallback(() => navigate('/appointments'), [navigate]);
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
    <div className={`app ${folded ? 'has-rail' : ''}`}>
      <div className="app-side">
        <Sidebar
          data={data}
          rail={folded}
          onToggleRail={tablet ? undefined : toggleRail}
          onSignOut={leave}
        />
      </div>

      <div className="app-main">
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

      <TabBar data={data} onCheckIn={checkIn} onOpenMenu={() => setDrawer(true)} />

      {drawer && <MenuDrawer data={data} onClose={() => setDrawer(false)} onSignOut={leave} />}
      {palette && <CommandPalette onClose={closePalette} onCheckIn={checkIn} onSignOut={leave} />}
    </div>
  );
}
