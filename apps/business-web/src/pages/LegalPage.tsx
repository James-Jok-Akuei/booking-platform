import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { acceptLegal, myLegalStatus, type LegalStatus } from '../api/business';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import './legal.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';
import { Plural } from '@lingui/react/macro';

const when = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { dateStyle: 'medium' });

const KIND: Record<string, { icon: IconName; blurb: string }> = {
  SELLER_AGREEMENT: {
    icon: 'store',
    get blurb() { return t`How you get paid, and what happens when a booking is cancelled.`; },
  },
  TERMS_OF_USE: {
    icon: 'legal',
    get blurb() { return t`The rules for using the platform, for everyone.`; },
  },
  PRIVACY_POLICY: {
    icon: 'shield',
    get blurb() { return t`What we keep about you and your customers, and why.`; },
  },
};

/**
 * What this business has agreed to (§122, §202).
 *
 * All three documents, unlike the customer app: a business is bound by the
 * Terms and the Privacy Policy like everyone, AND by the Seller Agreement, which
 * is the one that says how it gets paid and what happens when it cancels.
 *
 * Nothing here blocks anything. Being locked out of your own calendar over a
 * wording change would cost a shop its day, and the honest answer is a clear
 * "this is new, please read it" — which is what the server already reports.
 */
export function LegalPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<LegalStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const documents = useQuery({ queryKey: ['legal'], queryFn: myLegalStatus });

  const accept = useMutation({
    mutationFn: acceptLegal,
    onSuccess: () => {
      setProblem(null);
      queryClient.invalidateQueries({ queryKey: ['legal'] });
      // The banner over every page reads its own copy (§126.3).
      queryClient.invalidateQueries({ queryKey: ['legal-status'] });
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'Could not save that.'),
  });

  const rows = documents.data ?? [];
  const outstanding = rows.filter((d) => d.needsAcceptance).length;

  return (
    <section className="lg">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>Legal</Trans></h1>
            <p className="muted">
              <Trans>
                What you have agreed to. Older versions are kept — what you agreed to stays as you read it, even
                after it is replaced.
              </Trans>
            </p>
          </div>
        </header>
      </div>

      {outstanding > 0 && (
        <p className="lg-banner">
          <Icon name="alert" size={18} />
          <span>
            <strong>
              <Plural
                value={outstanding}
                one="# document has changed since you agreed."
                other="# documents have changed since you agreed."
              />
            </strong>{' '}
            <Trans>Nothing stops working — please read and agree when you can.</Trans>
          </span>
        </p>
      )}
      {documents.data && rows.length > 0 && outstanding === 0 && (
        <p className="lg-banner is-ok">
          <Icon name="checkCircle" size={18} />
          <span>
            <Trans><strong>You are up to date.</strong> You have agreed to the latest version of everything.</Trans>
          </span>
        </p>
      )}

      {documents.isLoading && <div className="skeleton lg-skeleton" />}
      {documents.data && rows.length === 0 && <p className="muted"><Trans>Nothing has been published yet.</Trans></p>}

      {problem && (
        <p className="notice" role="alert">
          {problem}
        </p>
      )}

      <div className="lg-grid">
        {rows.map((document, i) => {
          const look = KIND[document.kind] ?? KIND.TERMS_OF_USE;
          const state =
            document.acceptedVersion === null ? 'new' : document.needsAcceptance ? 'changed' : 'agreed';
          return (
            <article
              key={document.id}
              className={`lg-doc is-${state}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="lg-doc-top">
                <span className="lg-doc-icon">
                  <Icon name={look.icon} size={22} />
                </span>
                <span className={`lg-state is-${state}`}>
                  <Icon name={state === 'agreed' ? 'check' : 'dot'} size={13} stroke={2.6} filled={state !== 'agreed'} />
                  {state === 'agreed' ? t`Agreed` : state === 'changed' ? t`Changed` : t`Not agreed yet`}
                </span>
              </div>
              <h2>{document.title}</h2>
              <p className="lg-blurb">{look.blurb}</p>
              <p className="lg-meta"><Trans>Version {document.version} · published {when(document.publishedAt)}</Trans>
              </p>
              <p className={`lg-status${document.needsAcceptance ? ' is-warn' : ''}`}>
                {document.acceptedVersion === null
                  ? t`You have not agreed to this yet.`
                  : document.needsAcceptance
                    ? t`You agreed to version ${document.acceptedVersion} on ${when(document.acceptedAt!)}. This one is newer.`
                    : t`Agreed on ${when(document.acceptedAt!)}.`}
              </p>
              {/* The one line that says what moved, shown only to somebody who
                  has already read an older version. */}
              {document.needsAcceptance && document.changeNote && (
                <p className="lg-change">
                  <strong><Trans>What changed:</Trans></strong> {document.changeNote}
                </p>
              )}
              <div className="lg-actions">
                <button type="button" onClick={() => setOpen(document)}>
                  <Icon name="eye" size={16} />{' '}
                  <Trans>Read it</Trans>
                </button>
                {document.needsAcceptance && (
                  <button
                    type="button"
                    className="primary"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(document.id)}
                  >
                    {accept.isPending && accept.variables === document.id ? t`Saving…` : t`I agree to this`}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {open && (
        <Panel
          eyebrow={t`Version ${open.version} · published ${when(open.publishedAt)}`}
          title={open.title}
          onClose={() => setOpen(null)}
          width={760}
          footer={
            open.needsAcceptance ? (
              <>
                <button type="button" onClick={() => setOpen(null)}>
                  <Trans>Not now</Trans>
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(open.id, { onSuccess: () => setOpen(null) })}
                >
                  {accept.isPending ? t`Saving…` : t`I agree to this`}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setOpen(null)}>
                <Trans>Close</Trans>
              </button>
            )
          }
        >
          {open.needsAcceptance && open.changeNote && (
            <p className="lg-change">
              <strong><Trans>What changed:</Trans></strong> {open.changeNote}
            </p>
          )}
          <pre className="lg-body">{open.body}</pre>
        </Panel>
      )}
    </section>
  );
}
