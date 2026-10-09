import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listLegalDocuments, publishLegalDraft, startLegalDraft, updateLegalDraft, type LegalDocument, type LegalKind } from '../api/admin';
import { ago } from '../lib/time';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { LegalText, blanksIn, blocksOf, diffBlocks } from '../ui/LegalText';
import './legal.css';

const KINDS: Array<{ value: LegalKind; label: string; who: string; icon: IconName }> = [
  { value: 'TERMS_OF_USE', label: 'Terms of Use', who: 'Everyone who uses the platform.', icon: 'legal' },
  { value: 'PRIVACY_POLICY', label: 'Privacy Policy', who: 'Everyone: what is held about them, and why.', icon: 'shield' },
  { value: 'SELLER_AGREEMENT', label: 'Seller Agreement', who: 'Shops, in the business app.', icon: 'store' },
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const agreed = (n: number) => `${n} ${n === 1 ? 'person' : 'people'} agreed`;

/**
 * Writing the documents people agree to (§253, §122).
 *
 * The rule the page is shaped around: **a published version is never edited**
 * — the server refuses — because what somebody agreed to must stay readable
 * exactly as they read it. A change is a new version; the old one stays, with
 * how many people are still on it.
 *
 * So the three documents sit on a shelf, each saying its live version and any
 * draft; the chosen one reads as a page beside its history; and a draft is
 * written beside a preview that marks, paragraph by paragraph, what it changes
 * from the live version. [BLANKS] still to fill in are counted and marked.
 */
export function LegalPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.find((k) => k.value === params.get('doc'))?.value ?? 'TERMS_OF_USE') as LegalKind;
  const [viewing, setViewing] = useState<number | null>(null);

  const documents = useQuery({ queryKey: ['legal'], queryFn: listLegalDocuments });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['legal'] });
  useEffect(() => setViewing(null), [kind]);

  const of = (k: LegalKind) => {
    const versions = (documents.data ?? []).filter((d) => d.kind === k).sort((a, b) => b.version - a.version);
    const draft = versions.find((d) => d.publishedAt === null) ?? null;
    const published = versions.filter((d) => d.publishedAt !== null);
    return { draft, published, live: published[0] ?? null };
  };
  const { draft, published, live } = of(kind);
  const chosen = KINDS.find((k) => k.value === kind)!;
  const shown = viewing === null ? live : published.find((v) => v.version === viewing) ?? live;

  return (
    <section className="lgl">
      {/* Not pinned: a document is long, and its own headers stay in view instead. */}
      <header className="page-head lgl-head">
        <div>
          <h1>Legal</h1>
          <p className="muted">What people agree to. A published version is never changed — a change is a new version, so the old wording survives for whoever agreed to it.</p>
        </div>
      </header>

      <div className="lgl-shelf" role="tablist" aria-label="Document">
        {KINDS.map((k) => {
          const doc = of(k.value);
          const blanks = doc.live ? blanksIn(doc.live.body) : 0;
          return (
            <button
              key={k.value}
              type="button"
              role="tab"
              aria-selected={kind === k.value}
              className={`lgl-doc${kind === k.value ? ' is-on' : ''}`}
              onClick={() => setParams(k.value === 'TERMS_OF_USE' ? {} : { doc: k.value }, { replace: true })}
            >
              <span className="lgl-doc-icon">
                <Icon name={k.icon} size={20} />
              </span>
              <span className="lgl-doc-text">
                <strong>{k.label}</strong>
                <em>{doc.live ? `Version ${doc.live.version} · live since ${day(doc.live.publishedAt)}` : 'Not published yet'}</em>
                <span className="lgl-doc-tags">
                  {doc.live && <i>{agreed(doc.live._count.acceptances)}</i>}
                  {doc.draft && <i className="is-draft">Draft v{doc.draft.version}</i>}
                  {blanks > 0 && <i className="is-blank">{blanks} blanks</i>}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {documents.isLoading && <div className="skeleton lgl-skel" />}

      {documents.data &&
        (draft ? (
          <Draft key={draft.id} draft={draft} live={live} onChanged={refresh} />
        ) : (
          <div className="lgl-read">
            <article className="lgl-paper">
              {shown ? (
                <>
                  <header className="lgl-paper-head">
                    <span className={`pill ${shown === live ? 'resolved' : 'closed'}`}>{shown === live ? 'Live' : 'Older version'}</span>
                    <strong>
                      {shown.title} · version {shown.version}
                    </strong>
                    <em>
                      Published {day(shown.publishedAt)}
                      {shown.publishedBy && ` by ${shown.publishedBy.email}`} · {agreed(shown._count.acceptances)}
                    </em>
                    {shown.changeNote && (
                      <p>
                        <b>What changed:</b> {shown.changeNote}
                      </p>
                    )}
                  </header>
                  <LegalText body={shown.body} />
                </>
              ) : (
                <div className="lgl-empty">
                  <span>
                    <Icon name={chosen.icon} size={28} />
                  </span>
                  <strong>No {chosen.label} yet</strong>
                  <p>Until one is published, the apps show nothing in its place. {chosen.who}</p>
                </div>
              )}
            </article>

            <aside className="lgl-side">
              <StartDraft kind={kind} hasLive={live !== null} onStarted={refresh} />
              {published.length > 0 && (
                <div className="lgl-history">
                  <h4>
                    <Icon name="clock" size={15} /> Versions
                  </h4>
                  <ol>
                    {published.map((v) => (
                      <li key={v.id}>
                        <button type="button" className={(shown?.id ?? '') === v.id ? 'is-on' : ''} onClick={() => setViewing(v === live ? null : v.version)}>
                          <b>v{v.version}</b>
                          <span>
                            <strong>{v === live ? 'Live' : day(v.publishedAt)}</strong>
                            <em>
                              {v === live && `${day(v.publishedAt)} · `}
                              {agreed(v._count.acceptances)}
                            </em>
                            {v.changeNote && <q>{v.changeNote}</q>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </aside>
          </div>
        ))}
    </section>
  );
}

function StartDraft({ kind, hasLive, onStarted }: { kind: LegalKind; hasLive: boolean; onStarted: () => void }) {
  const start = useMutation({ mutationFn: () => startLegalDraft(kind), onSuccess: onStarted });
  return (
    <div className="lgl-start">
      <button type="button" className="primary" disabled={start.isPending} onClick={() => start.mutate()}>
        <Icon name="pencil" size={16} />
        {start.isPending ? 'Starting…' : hasLive ? 'Write a new version' : 'Write the first version'}
      </button>
      <p>{hasLive ? 'It starts as a copy of the live one, so you change the sentence rather than retype the document. Nobody sees it until you publish.' : 'Nobody sees it until you publish.'}</p>
      {start.error && (
        <p className="error small" role="alert">
          {start.error instanceof ApiError ? start.error.message : 'That did not work.'}
        </p>
      )}
    </div>
  );
}

function Draft({ draft, live, onChanged }: { draft: LegalDocument; live: LegalDocument | null; onChanged: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [note, setNote] = useState(draft.changeNote ?? '');
  const [showChanges, setShowChanges] = useState(live !== null);
  const [problem, setProblem] = useState<string | null>(null);

  // A save resets the form to what the server stored, not what was typed.
  useEffect(() => {
    setTitle(draft.title);
    setBody(draft.body);
    setNote(draft.changeNote ?? '');
  }, [draft.id, draft.updatedAt]);

  const dirty = title !== draft.title || body !== draft.body || note !== (draft.changeNote ?? '');
  const changes = useMemo(() => (live ? diffBlocks(blocksOf(live.body), blocksOf(body)) : []), [live, body]);
  const added = changes.filter((c) => c.kind === 'added').length;
  const removed = changes.filter((c) => c.kind === 'removed').length;
  const blanks = blanksIn(body);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  const save = useMutation({
    mutationFn: () => updateLegalDraft(draft.id, { title, body, changeNote: note || undefined }),
    onSuccess: () => {
      setProblem(null);
      onChanged();
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'Could not save that.'),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await updateLegalDraft(draft.id, { title, body, changeNote: note || undefined });
      return publishLegalDraft(draft.id);
    },
    onSuccess: () => {
      setProblem(null);
      onChanged();
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'Could not publish that.'),
  });

  const onPublish = async () => {
    const sure = await confirmDialog({
      title: `Publish version ${draft.version}?`,
      body: (
        <>
          <p>
            Everyone sees it at once, and it can never be edited — a change after this is another version.
            {live && ` Anyone who agreed to version ${live.version} is asked to agree to this one.`}
          </p>
          {live && (
            <p>
              <strong>
                {added} {added === 1 ? 'paragraph' : 'paragraphs'} added, {removed} taken out or changed.
              </strong>
              {!note.trim() && ' There is no note of what changed — people being asked again will see none.'}
            </p>
          )}
          {blanks > 0 && (
            <p>
              <strong>
                {blanks} [blanks] are still in the text
              </strong>{' '}
              and will be published as they are.
            </p>
          )}
        </>
      ),
      tone: 'warn',
      icon: 'legal',
      confirmLabel: 'Publish',
      cancelLabel: 'Keep editing',
    });
    if (sure) publish.mutate();
  };

  return (
    <div className="lgl-draft">
      <div className="lgl-editor">
        <div className="lgl-editor-head">
          <span className="pill pending">Draft · version {draft.version}</span>
          <em>Nobody can see this yet. Started {ago(draft.createdAt)}.</em>
        </div>
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        </label>
        <label className="lgl-body-field">
          <span>
            The document <em>— plain text; a blank line starts a new paragraph, a line in CAPITALS is a heading, “- ” starts a list</em>
          </span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} spellCheck placeholder="Plain text. Leave a blank line between paragraphs." />
        </label>
        <label>
          <span>
            What changed <em>— shown to people asked to agree again; nobody rereads four thousand words to find the sentence that moved</em>
          </span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Added a section on refunds" />
        </label>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
        <div className="lgl-editor-foot">
          <span className={dirty ? 'is-dirty' : ''}>
            {dirty ? 'Changes not saved' : `Saved ${ago(draft.updatedAt)}`} · {words.toLocaleString()} words
            {blanks > 0 && ` · ${blanks} blanks`}
          </span>
          <button type="button" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" className="primary" disabled={publish.isPending || body.trim().length === 0} onClick={() => void onPublish()}>
            <Icon name="send" size={15} />
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>

      <article className="lgl-paper is-preview">
        <header className="lgl-paper-head">
          <span className="pill closed">Preview</span>
          <strong>{title || 'Untitled'}</strong>
          {live ? (
            <div className="lgl-diffbar">
              <button type="button" className={showChanges ? 'is-on' : ''} onClick={() => setShowChanges(true)}>
                Changes from v{live.version}
                <i className="is-add">+{added}</i>
                <i className="is-del">−{removed}</i>
              </button>
              <button type="button" className={showChanges ? '' : 'is-on'} onClick={() => setShowChanges(false)}>
                As it will read
              </button>
            </div>
          ) : (
            <em>The first version: everything is new.</em>
          )}
        </header>
        <LegalText body={body} against={live && showChanges ? live.body : undefined} />
      </article>
    </div>
  );
}
