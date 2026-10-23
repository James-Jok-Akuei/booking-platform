import { useEffect, useRef } from 'react';
import { t } from '@lingui/core/macro';
import { Icon } from '../ui/Icon';
import { Portal } from '../ui/Portal';
import { ShopLogo } from '../ui/ShopLogo';
import { AppQr } from './AppQr';
import type { CardWords } from './cardWords';

/**
 * The code as large as the screen allows (§309), for turning a phone or a
 * tablet towards a customer at the till: the shop, the code, "Scan with your
 * camera". The screen is kept awake while it is up (where the browser allows),
 * so it does not dim in the customer's hand. Esc or ✕ puts it away.
 */
export function ShowQr({
  link,
  shop,
  logoUrl,
  words,
  lang,
  onClose,
}: {
  link: string;
  shop: string;
  logoUrl: string | null;
  words: CardWords;
  lang: string;
  onClose: () => void;
}) {
  // Read when it happens, so a new function from the page never re-asks for the screen lock.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // First and alone: Esc puts the code away, not a window opened beneath it (check-in).
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', key, true);
    document.documentElement.classList.add('aq-showing');
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => (gone ? void sentinel.release() : (lock = sentinel)))
      .catch(() => undefined);
    return () => {
      gone = true;
      window.removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('aq-showing');
      void lock?.release().catch(() => undefined);
    };
  }, []);

  return (
    <Portal>
      {/* Clicks stay here: drawn in <body>, they would otherwise reach the window that opened it. */}
      <div
        className="aq-show"
        role="dialog"
        aria-modal="true"
        aria-label={t`App QR code`}
        lang={lang}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="aq-show-close" onClick={onClose} aria-label={t`Close`} autoFocus>
          <Icon name="close" size={22} />
        </button>
        <div className="aq-show-inner">
          <div className="aq-show-shop">
            <ShopLogo logoUrl={logoUrl} name={shop} size={40} />
            <strong>{shop}</strong>
          </div>
          <div className="aq-show-code">
            {/* Nothing moves over it here: this is the one a camera is reading. */}
            <AppQr text={link} label={words.lead} />
          </div>
          <p className="aq-show-scan">{words.scan}</p>
          <p className="aq-show-lead">{words.lead}</p>
        </div>
      </div>
    </Portal>
  );
}
