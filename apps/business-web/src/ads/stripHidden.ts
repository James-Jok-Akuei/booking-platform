/**
 * Whether the seller has closed the slim "For you" banner (§223). It stays
 * closed on every page until they next sign in: signing in, signing out or the
 * session ending clears it. Kept in the browser, so a reload does not bring it
 * back mid-session.
 */
const KEY = 'booking-business.ad-strip-hidden';

export const isStripHidden = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const hideStrip = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Private mode: it closes for this page only.
  }
};

export const showStripAgain = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
};
