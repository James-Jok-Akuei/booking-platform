import { useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Icon } from './Icon';
import { chooseLocale, offeredLanguages, useSiteLocale } from './i18n';

/**
 * Choosing the page's language (§308): each language written in itself —
 * "Ikinyarwanda", "Français" — so a visitor finds theirs whatever the page is
 * in now. Only finished, checked languages are offered; with one there is
 * nothing to choose, and nothing is shown.
 *
 * `menu`: a globe in the top bar that opens the list — on the dark hero,
 * small on a phone. `row`: every language side by side, in the footer.
 */
export function LanguageChoice({ variant }: { variant: 'menu' | 'row' }) {
  const current = useSiteLocale();
  const languages = offeredLanguages();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (languages.length < 2) return null;
  const pick = (code: (typeof languages)[number]['code']) => {
    setOpen(false);
    if (code !== current) void chooseLocale(code);
  };

  if (variant === 'row') {
    return (
      <div className="lang-row" role="radiogroup" aria-label={t`Language`}>
        <Icon name="globe" size={15} />
        {languages.map((language) => (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={language.code === current}
            className={`lang-option${language.code === current ? ' is-on' : ''}`}
            onClick={() => pick(language.code)}
          >
            {language.native}
          </button>
        ))}
      </div>
    );
  }

  const now = languages.find((language) => language.code === current) ?? languages[0];
  return (
    <div className="lang-menu" ref={ref}>
      <button
        type="button"
        className="lang-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t`Language: ${now.native}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="globe" size={17} />
        <span className="lang-now">{now.native}</span>
        <Icon name="chevronDown" size={14} stroke={2.2} />
      </button>
      {open && (
        <ul className="lang-list" role="menu">
          {languages.map((language) => (
            <li key={language.code} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={language.code === current}
                className={language.code === current ? 'is-on' : ''}
                onClick={() => pick(language.code)}
              >
                {language.native}
                {language.code === current && <Icon name="check" size={15} stroke={2.4} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
