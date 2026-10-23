import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useAccess } from '../access';
import { navItemsFor } from '../nav';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import './not-found.css';

/** The usual places, in the order a seller reaches for them. */
const USUAL = ['/', '/appointments', '/messages', '/services', '/profile', '/help'];

/**
 * An address that is no page (§311): said kindly, inside the app's frame, with
 * the way back and the usual places — never a blank screen, never a silent
 * jump to the Overview that leaves someone wondering where their link went.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const access = useAccess();
  const places = navItemsFor(access).filter((item) => USUAL.includes(item.to));
  // Opened from a link, there is nothing to go back to.
  const canGoBack = window.history.length > 1;

  return (
    <div className="nf">
      <EmptyState
        art="lost"
        title={t`This page does not exist`}
        text={t`The address may be mistyped, or the page has moved. Nothing of yours is lost — here is the way back.`}
        below={
          <div className="nf-places">
            <p>
              <Trans>Or go straight to</Trans>
            </p>
            <ul>
              {places.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>
                    <span className="nf-place-icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="nf-place-words">
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
            <button type="button" className="nf-search" onClick={() => window.dispatchEvent(new Event('app:search'))}>
              <Icon name="search" size={16} />
              <Trans>Search every page</Trans>
              <kbd>⌘K</kbd>
            </button>
          </div>
        }
      >
        <button type="button" className="primary" onClick={() => navigate('/')}>
          <Icon name="overview" size={18} />
          <Trans>Go to Overview</Trans>
        </button>
        {canGoBack && (
          <button type="button" onClick={() => navigate(-1)}>
            <Icon name="chevronLeft" size={18} />
            <Trans>Go back</Trans>
          </button>
        )}
      </EmptyState>
      <p className="nf-address">
        <Trans>Address asked for:</Trans> <code>{pathname}</code>
      </p>
    </div>
  );
}
