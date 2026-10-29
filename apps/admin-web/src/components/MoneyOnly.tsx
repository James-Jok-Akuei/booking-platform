import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyAccess } from '../lib/access';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';

/**
 * A money page (§317), for an administrator with money access. Anyone else
 * who reaches its address — a bookmark, a link from a colleague — is told why
 * it is not for them and who can change that, rather than shown a broken page.
 */
export function MoneyOnly({ children }: { children: ReactNode }) {
  const access = useMyAccess();
  const navigate = useNavigate();
  if (!access.known) return <div className="skeleton" style={{ height: 260, borderRadius: 26 }} />;
  if (!access.money) {
    return (
      <EmptyState
        art="bank"
        title="This page is for money access"
        text="It shows or moves the platform’s money, so it is only for the primary administrator and the people they trust with money. The primary administrator can turn money access on for you, under Users."
      >
        <button type="button" className="primary" onClick={() => navigate('/')}>
          <Icon name="overview" size={18} />
          Go to Overview
        </button>
      </EmptyState>
    );
  }
  return <>{children}</>;
}
