import { Link, useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';
import { useMyAccess } from '../lib/access';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import './not-found.css';

/** The usual places, in the order an administrator reaches for them. */
const USUAL = ['/', '/businesses', '/tickets', '/payouts', '/appointments', '/users'];

/**
 * An address that is no page (§311): said plainly, inside the console's frame,
 * with the way back and the usual places — never a blank screen, never a silent
 * jump to the Overview that leaves someone wondering where their link went.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Money pages only for those with money access (§317).
  const { money } = useMyAccess();
  const places = USUAL.map((to) => NAV_ITEMS.find((item) => item.to === to))
    .filter((item) => item !== undefined)
    .filter((item) => money || !item.money);
  const canGoBack = window.history.length > 1;

  return (
    <div className="nf">
      <EmptyState
        art="lost"
        title="This page does not exist"
        text="The address may be mistyped, or the page has moved. Nothing has changed — here is the way back."
        below={
          <div className="nf-places">
            <p>Or go straight to</p>
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
              Search every page
              <kbd>⌘K</kbd>
            </button>
          </div>
        }
      >
        <button type="button" className="primary" onClick={() => navigate('/')}>
          <Icon name="overview" size={18} />
          Go to Overview
        </button>
        {canGoBack && (
          <button type="button" onClick={() => navigate(-1)}>
            <Icon name="chevronLeft" size={18} />
            Go back
          </button>
        )}
      </EmptyState>
      <p className="nf-address">
        Address asked for: <code>{pathname}</code>
      </p>
    </div>
  );
}
