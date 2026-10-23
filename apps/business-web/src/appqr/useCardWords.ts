import { useEffect, useMemo, useState } from 'react';
import { i18n, type I18n } from '@lingui/core';
import type { AppLocale } from '../i18n';
import { cardWords, languageFor, type CardWords } from './cardWords';

/** The card's words in `locale` — the app's own until that language's file is here (§309). */
export function useCardWords(locale: AppLocale, shop: string): CardWords {
  const [language, setLanguage] = useState<I18n | null>(null);
  useEffect(() => {
    let current = true;
    void languageFor(locale)
      .then((loaded) => current && setLanguage(loaded))
      .catch(() => current && setLanguage(null));
    return () => {
      current = false;
    };
  }, [locale]);
  return useMemo(() => cardWords(language ?? i18n, shop), [language, shop]);
}
