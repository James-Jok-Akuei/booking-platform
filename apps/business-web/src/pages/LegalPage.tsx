import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { acceptLegal, myLegalStatus, type LegalStatus } from '../api/business';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import './legal.css';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const KIND: Record<string, { icon: IconName; blurb: string }> = {
  SELLER_AGREEMENT: { icon: 'store', blurb: 'How you get paid, and what happens when a booking is cancelled.' },
  TERMS_OF_USE: { icon: 'legal', blurb: 'The rules for using the platform, for everyone.' },
  PRIVACY_POLICY: { icon: 'shield', blurb: 'What we keep about you and your customers, and why.' },
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
      <header className="page-head">
        <div>
          <h1>Legal</h1>
          <p className="muted">
            What you have agreed to. Older versions are kept — what you agreed to stays as you read it, even
            after it is replaced.
          </p>
        </div>
      </header>

      {outstanding > 0 && (
        <p className="lg-banner">
          <Icon name="alert" size={18} />
          <span>
            <strong>
              {outstanding} {outstanding === 1 ? 'document has' : 'documents have'} changed since you agreed.
            </strong>{' '}
            Nothing stops working — please read and agree when you can.
          </span>
        </p>
      )}
      {documents.data && rows.length > 0 && outstanding === 0 && (
        <p className="lg-banner is-ok">
          <Icon name="checkCircle" size={18} />
          <span>
            <strong>You are up to date.</strong> You have agreed to the latest version of everything.
          </span>
        </p>
      )}

      {documents.isLoading && <div className="skeleton lg-skeleton" />}
      {documents.data && rows.length === 0 && <p className="muted">Nothing has been published yet.</p>}

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
                  {state === 'agreed' ? 'Agreed' : state === 'changed' ? 'Changed' : 'Not agreed yet'}
                </span>
              </div>
              <h2>{document.title}</h2>
              <p className="lg-blurb">{look.blurb}</p>
              <p className="lg-meta">
                Version {document.version} · published {when(document.publishedAt)}
              </p>
              <p className={`lg-status${document.needsAcceptance ? ' is-warn' : ''}`}>
                {document.acceptedVersion === null
                  ? 'You have not agreed to this yet.'
                  : document.needsAcceptance
                    ? `You agreed to version ${document.acceptedVersion} on ${when(document.acceptedAt!)}. This one is newer.`
                    : `Agreed on ${when(document.acceptedAt!)}.`}
              </p>
              {/* The one line that says what moved, shown only to somebody who
                  has already read an older version. */}
              {document.needsAcceptance && document.changeNote && (
                <p className="lg-change">
                  <strong>What changed:</strong> {document.changeNote}
                </p>
              )}
              <div className="lg-actions">
                <button type="button" onClick={() => setOpen(document)}>
                  <Icon name="eye" size={16} /> Read it
                </button>
                {document.needsAcceptance && (
                  <button
                    type="button"
                    className="primary"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(document.id)}
                  >
                    {accept.isPending && accept.variables === document.id ? 'Saving…' : 'I agree to this'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {open && (
        <Panel
          eyebrow={`Version ${open.version} · published ${when(open.publishedAt)}`}
          title={open.title}
          onClose={() => setOpen(null)}
          width={760}
          footer={
            open.needsAcceptance ? (
              <>
                <button type="button" onClick={() => setOpen(null)}>
                  Not now
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(open.id, { onSuccess: () => setOpen(null) })}
                >
                  {accept.isPending ? 'Saving…' : 'I agree to this'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setOpen(null)}>
                Close
              </button>
            )
          }
        >
          {open.needsAcceptance && open.changeNote && (
            <p className="lg-change">
              <strong>What changed:</strong> {open.changeNote}
            </p>
          )}
          <pre className="lg-body">{open.body}</pre>
        </Panel>
      )}
    </section>
  );
}
