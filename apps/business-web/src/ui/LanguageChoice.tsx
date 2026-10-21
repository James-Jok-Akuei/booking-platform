import { t } from '@lingui/core/macro';
import { chooseLocale, offeredLanguages, useAppLocale } from '../i18n';
import { Icon } from './Icon';
import './language-choice.css';

/**
 * Choosing the app's language (§308): each language written in itself —
 * "Ikinyarwanda", "Français" — so a person finds theirs whatever the app is
 * in now. Only finished, checked languages are offered; with one, there is
 * nothing to choose and nothing is shown.
 */
export function LanguageChoice({ compact = false }: { compact?: boolean }) {
  const current = useAppLocale();
  const languages = offeredLanguages();
  if (languages.length < 2) return null;
  return (
    <div className={`lang${compact ? ' is-compact' : ''}`} role="radiogroup" aria-label={t`Language`}>
      <Icon name="globe" size={15} />
      {languages.map((language) => {
        const on = language.code === current;
        return (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={on}
            className={`lang-option${on ? ' is-on' : ''}`}
            title={language.name}
            onClick={() => {
              if (!on) void chooseLocale(language.code);
            }}
          >
            {language.native}
          </button>
        );
      })}
    </div>
  );
}
