import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { acceptLegal, myLegalStatus, type LegalStatus } from '../api/business';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * What this business has agreed to (§122).
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
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const documents = useQuery({ queryKey: ['legal'], queryFn: myLegalStatus });

  const accept = useMutation({
    mutationFn: acceptLegal,
    onSuccess: () => {
      setProblem(null);
      queryClient.invalidateQueries({ queryKey: ['legal'] });
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'Could not save that.'),
  });

  const rows = documents.data ?? [];
  const outstanding = rows.filter((d) => d.needsAcceptance).length;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Legal</h1>
          <p className="muted">
            What you have agreed to. Older versions are kept — what you agreed to
            stays as you read it, even after it is replaced.
          </p>
        </div>
      </header>

      {outstanding > 0 && (
        <p className="notice">
          <strong>
            {outstanding} {outstanding === 1 ? 'document has' : 'documents have'} changed
            since you agreed.
          </strong>{' '}
          Nothing stops working — please read and agree when you can.
        </p>
      )}

      {documents.isLoading && <p className="muted">Loading…</p>}
      {documents.data && rows.length === 0 && (
        <p className="muted empty">Nothing has been published yet.</p>
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      {rows.map((document: LegalStatus) => (
        <div key={document.id} className="card">
          <div className="setting-head">
            <h2>{document.title}</h2>
            <p className="muted small">
              Version {document.version} · published {when(document.publishedAt)}
            </p>
          </div>

          <p className={document.needsAcceptance ? 'error small' : 'muted small'}>
            {document.acceptedVersion === null
              ? 'You have not agreed to this yet.'
              : document.needsAcceptance
                ? `You agreed to version ${document.acceptedVersion} on ${when(document.acceptedAt!)}. This one is newer.`
                : `Agreed on ${when(document.acceptedAt!)}.`}
          </p>

          {/* The one line that says what moved, shown only to somebody who has
              already read an older version. */}
          {document.needsAcceptance && document.changeNote && (
            <p className="muted small">What changed: {document.changeNote}</p>
          )}

          <button
            type="button"
            className="link"
            onClick={() => setOpen(open === document.id ? null : document.id)}
          >
            {open === document.id ? 'Hide' : 'Read it'}
          </button>

          {open === document.id && <pre className="legal-body">{document.body}</pre>}

          {document.needsAcceptance && (
            <div className="row-end">
              <button
                type="button"
                className="primary"
                disabled={accept.isPending}
                onClick={() => accept.mutate(document.id)}
              >
                {accept.isPending ? 'Saving…' : 'I agree to this'}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
