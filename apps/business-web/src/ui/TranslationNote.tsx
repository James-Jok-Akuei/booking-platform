import { Trans } from '@lingui/react/macro';
import { Icon } from './Icon';
import './translation-note.css';

/**
 * Beside a legal document read in translation (§308.5): where a translation
 * and the English differ, the English applies — said plainly, with the
 * English one press away. Reading the English, the same press goes back.
 */
export function TranslationNote({ english, onToggle }: { english: boolean; onToggle?: () => void }) {
  return (
    <p className="tr-note">
      <Icon name="globe" size={16} />
      <span>
        {english ? (
          <Trans>This is the English, which applies wherever a translation differs.</Trans>
        ) : (
          <Trans>This is a translation. If it ever differs from the English, the English applies.</Trans>
        )}{' '}
        {onToggle && (
          <button type="button" className="link" onClick={onToggle}>
            {english ? <Trans>Read it in my language</Trans> : <Trans>Read the English</Trans>}
          </button>
        )}
      </span>
    </p>
  );
}
