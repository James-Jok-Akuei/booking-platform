import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Being sent to a button (§306): the sidebar's shop card opens the Overview
 * with `state: { spotlight: name }`, and the button of that name — Post my
 * shop, Send for review — is scrolled to the middle of the screen and lit for
 * a few seconds, so the one thing to do is the first thing seen.
 *
 * A callback ref, because the card draws its button only once the shop's
 * state has loaded: nothing happens until the button is there. The request is
 * then taken out of the page's history, so Back or a reload does not light it
 * again.
 */
export function useSpotlight(name: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [lit, setLit] = useState(false);
  const asked = (location.state as { spotlight?: string } | null)?.spotlight === name;

  useEffect(() => {
    if (!asked || !element) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    setLit(true);
    // `location.key`: asked again from the sidebar while already here, it lights again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, element, location.key]);

  useEffect(() => {
    if (!lit) return;
    const timer = window.setTimeout(() => setLit(false), 5500);
    return () => window.clearTimeout(timer);
  }, [lit]);

  return { ref: setElement, lit, done: () => setLit(false) };
}
