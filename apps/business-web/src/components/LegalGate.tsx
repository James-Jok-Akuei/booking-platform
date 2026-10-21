import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptLegal, myLegalStatus, type LegalStatus } from '../api/business';
import { TranslationNote } from '../ui/TranslationNote';
import { Icon } from '../ui/Icon';
import { Portal } from '../ui/Portal';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * What this business still has to agree to (§126).
 *
 * One query behind both uses, so the banner and the gate can never disagree
 * about whether something is outstanding.
 */
export function useOutstandingLegal() {
  const documents = useQuery({
    queryKey: ['legal-status'],
    queryFn: () => myLegalStatus(),
    // Changes only when an admin publishes, which is rare.
    staleTime: 10 * 60 * 1000,
  });
  const outstanding = (documents.data ?? []).filter((d) => d.needsAcceptance);
  return {
    outstanding,
    sellerAgreement: outstanding.find((d) => d.kind === 'SELLER_AGREEMENT') ?? null,
  };
}

/**
 * Asked for before putting a service in front of customers (§126.4).
 *
 * This one BLOCKS, unlike the notice that greets a changed document. Listing a
 * service is the business holding itself to the Seller Agreement, so doing it
 * while that agreement is unread is the one case worth stopping outright — and
 * the server refuses it too, so this is an explanation rather than the
 * enforcement.
 *
 * The document is readable here, in full, without leaving the page somebody was
 * in the middle of. Sending them away to find it is how a dialogue becomes a
 * thing people dismiss.
 */
export function SellerAgreementGate({
  document,
  onAccepted,
  onCancel,
}: {
  document: LegalStatus;
  onAccepted: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState(false);

  const accept = useMutation({
    mutationFn: () => acceptLegal(document),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal-status'] });
      queryClient.invalidateQueries({ queryKey: ['legal'] });
      onAccepted();
    },
  });

  return (
    <Portal>
      <div className="drawer-backdrop" onClick={onCancel}>
        <aside
          className="drawer"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="drawer-head">
            <div>
              <h2>{document.title}</h2>
              <p className="muted small"><Trans>Version {document.version}</Trans>
                {document.acceptedVersion !== null
                  ? t` · you agreed to version ${document.acceptedVersion}`
                  : t` · you have not agreed to this yet`}
              </p>
            </div>
          </div>

          <p className="notice">
            <Trans>
              <strong>Please accept this before listing a service.</strong> Listing one
              is you agreeing to trade under these terms, so it is the one thing we
              stop until you have read them.
            </Trans>
          </p>

          {document.changeNote && (
            <p className="muted small"><Trans>What changed: {document.changeNote}</Trans></p>
          )}

          <button type="button" className="link" onClick={() => setReading((v) => !v)}>
            {reading ? t`Hide` : t`Read it`}
          </button>
          {reading && document.language !== 'en' && <TranslationNote english={false} />}
          {reading && <pre className="legal-body">{document.body}</pre>}

          <div className="row-end">
            <button type="button" className="link" onClick={onCancel}>
              <Trans>Not now</Trans>
            </button>
            <button
              type="button"
              className="primary"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? t`Saving…` : t`I agree`}
            </button>
          </div>
        </aside>
      </div>
    </Portal>
  );
}

/**
 * The quieter half: something changed and nothing is blocked (§126.3).
 *
 * A banner rather than a dialogue, because a shop opening its appointments on a
 * Monday morning should not meet a modal. It is persistent, it says what moved,
 * and the Legal page is one click away.
 */
export function LegalBanner() {
  const { outstanding } = useOutstandingLegal();
  if (outstanding.length === 0) return null;

  return (
    <div className="legal-banner">
      <span className="lb-icon">
        <Icon name="legal" size={18} />
      </span>
      <p className="lb-text">
        <strong>
          {outstanding.length === 1
            ? t`${outstanding[0].title} has changed.`
            : t`${outstanding.length} documents have changed.`}
        </strong>{' '}
        {outstanding.length === 1 && outstanding[0].changeNote
          ? outstanding[0].changeNote
          : t`Please read and agree when you can.`}
      </p>
      <Link to="/legal" className="lb-action">
        <Trans>Read and agree</Trans>
      <Icon name="arrowRight" size={15} stroke={2.2} />
      </Link>
    </div>
  );
}
