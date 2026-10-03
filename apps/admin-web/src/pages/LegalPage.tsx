import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listLegalDocuments,
  publishLegalDraft,
  startLegalDraft,
  updateLegalDraft,
  type LegalDocument,
  type LegalKind,
} from '../api/admin';

const KINDS: Array<{ value: LegalKind; label: string; who: string }> = [
  { value: 'TERMS_OF_USE', label: 'Terms of Use', who: 'Everyone who uses the platform.' },
  { value: 'PRIVACY_POLICY', label: 'Privacy Policy', who: 'Everyone. What you hold about them and why.' },
  { value: 'SELLER_AGREEMENT', label: 'Seller Agreement', who: 'Businesses. Shown in the business app.' },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

/**
 * Writing the documents people agree to (§122).
 *
 * The rule the whole screen is shaped around: **a published version is never
 * edited.** It cannot be — the server refuses — because what somebody agreed to
 * has to stay readable exactly as they read it. A change is a new version, and
 * the old one stays beside it with the count of people still on it.
 *
 * So each kind shows its current version read-only, and editing happens in a
 * draft that only exists while it is being written.
 */
export function LegalPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LegalKind>('TERMS_OF_USE');

  const documents = useQuery({ queryKey: ['legal'], queryFn: listLegalDocuments });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['legal'] });

  const versions = (documents.data ?? []).filter((d) => d.kind === kind);
  const draft = versions.find((d) => d.publishedAt === null) ?? null;
  const published = versions.filter((d) => d.publishedAt !== null);
  const current = published[0] ?? null;
  const chosen = KINDS.find((k) => k.value === kind)!;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Legal</h1>
          <p className="muted">
            What people agree to. A published version is never changed — a change
            is a new version, so the old wording survives for whoever agreed to it.
          </p>
        </div>
        <div className="tabs">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === kind ? 'tab active' : 'tab'}
              onClick={() => setKind(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <p className="muted small">{chosen.who}</p>

      {documents.isLoading && <p className="muted">Loading…</p>}

      {documents.data && !current && !draft && (
        <p className="muted empty">
          Nothing written yet. Until this is published, the apps show nothing in
          its place.
        </p>
      )}

      {current && (
        <div className="card">
          <div className="setting-head">
            <h2>
              Live — version {current.version}
            </h2>
            <p className="muted small">
              Published {when(current.publishedAt)}
              {current.publishedBy ? ` by ${current.publishedBy.email}` : ''} ·{' '}
              {current._count.acceptances} {current._count.acceptances === 1 ? 'person has' : 'people have'} agreed
            </p>
          </div>
          {current.changeNote && <p className="muted small">{current.changeNote}</p>}
          <pre className="legal-body">{current.body}</pre>
        </div>
      )}

      {draft ? (
        <DraftEditor draft={draft} onSaved={refresh} />
      ) : (
        <StartDraft kind={kind} hasCurrent={current !== null} onStarted={refresh} />
      )}

      {published.length > 1 && (
        <div className="card">
          <h2>Older versions</h2>
          <ul className="card-list">
            {published.slice(1).map((version) => (
              <li key={version.id} className="card-row" style={{ cursor: 'default' }}>
                <div>
                  <strong>Version {version.version}</strong>
                  <div className="muted small">
                    Published {when(version.publishedAt)} ·{' '}
                    {version._count.acceptances} agreed
                  </div>
                  {version.changeNote && (
                    <div className="muted small">{version.changeNote}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StartDraft({
  kind,
  hasCurrent,
  onStarted,
}: {
  kind: LegalKind;
  hasCurrent: boolean;
  onStarted: () => void;
}) {
  const start = useMutation({ mutationFn: () => startLegalDraft(kind), onSuccess: onStarted });

  return (
    <div className="card">
      <div className="row-end">
        <button type="button" className="primary" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending
            ? 'Starting…'
            : hasCurrent
              ? 'Write a new version'
              : 'Write the first version'}
        </button>
      </div>
      {hasCurrent && (
        <p className="muted small">
          The new version starts as a copy of the live one, so you change the
          sentence rather than retyping the document.
        </p>
      )}
    </div>
  );
}

function DraftEditor({ draft, onSaved }: { draft: LegalDocument; onSaved: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [note, setNote] = useState(draft.changeNote ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  // Reset whenever the server's copy changes, so a save leaves the form showing
  // what was actually stored rather than what was typed.
  useEffect(() => {
    setTitle(draft.title);
    setBody(draft.body);
    setNote(draft.changeNote ?? '');
  }, [draft.id, draft.updatedAt]);

  const save = useMutation({
    mutationFn: () =>
      updateLegalDraft(draft.id, { title, body, changeNote: note || undefined }),
    onSuccess: () => {
      setProblem(null);
      onSaved();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'Could not save that.'),
  });

  const publish = useMutation({
    mutationFn: () => publishLegalDraft(draft.id),
    onSuccess: () => {
      setProblem(null);
      onSaved();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'Could not publish that.'),
  });

  return (
    <div className="card">
      <div className="setting-head">
        <h2>Draft — version {draft.version}</h2>
        <p className="muted small">
          Nobody can see this yet. Once published it cannot be changed, only
          replaced by a newer version.
        </p>
      </div>

      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
      </label>

      <label>
        The document
        <textarea
          className="legal-input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={22}
          placeholder="Plain text. Leave a blank line between paragraphs."
        />
        <span className="muted small">
          Plain text, not HTML — it has to read the same in a browser and on a
          phone. A blank line starts a new paragraph.
        </span>
      </label>

      <label>
        What changed <span className="muted small">(optional)</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={300}
          placeholder="Added a section on refunds"
        />
        <span className="muted small">
          Shown to people who already agreed to the last version. Nobody rereads
          four thousand words to find the sentence that moved.
        </span>
      </label>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}

      <div className="row-end">
        <button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={publish.isPending || body.trim().length === 0}
          onClick={() => {
            if (
              window.confirm(
                `Publish version ${draft.version}?\n\n` +
                  'Everyone sees it immediately, and it can never be edited — a ' +
                  'change after this is another new version.\n\n' +
                  'Anyone who agreed to the last version will be asked to agree ' +
                  'to this one.',
              )
            ) {
              publish.mutate();
            }
          }}
        >
          {publish.isPending ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  );
}
