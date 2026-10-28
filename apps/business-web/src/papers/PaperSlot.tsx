import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { openDocument, removeDocument, uploadDocument, type BusinessDocument, type DocumentKind } from '../api/business';
import { formatDate } from '../i18n/format';
import { shortDay } from '../lib/time';
import { confirmDialog } from '../ui/Dialog';
import { DropZone, PAPERS, sortFiles } from '../ui/DropZone';
import { Icon } from '../ui/Icon';
import { PAPER_WORDS } from './words';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import './papers.css';

/** How long before a paper runs out that it is flagged (the server's EXPIRY_WARNING_DAYS). */
const SOON_DAYS = 30;

const said = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** A date the paper carries (no time of day): read as the day it names, with its year, wherever the reader is. */
const onDay = (iso: string) => formatDate(`${iso.slice(0, 10)}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' });

const sizeWords = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Where a paper stands, as a pill. */
function StatusPill({ doc }: { doc: BusinessDocument }) {
  if (doc.expired) return <span className="pill rejected"><Trans>Run out</Trans></span>;
  if (doc.status === 'VERIFIED') return <span className="pill verified"><Trans>Checked</Trans></span>;
  if (doc.status === 'REFUSED') return <span className="pill rejected"><Trans>Not accepted</Trans></span>;
  return <span className="pill pending"><Trans>Waiting for our team</Trans></span>;
}

/** When it runs out, said with the urgency it deserves. */
function Expiry({ doc }: { doc: BusinessDocument }) {
  if (!doc.expiresAt) return null;
  const days = Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / 86_400_000);
  const day = onDay(doc.expiresAt);
  if (days < 0) return <span className="pp-expiry is-bad"><Icon name="alert" size={13} /> {t`Ran out on ${day}`}</span>;
  if (days <= SOON_DAYS) return <span className="pp-expiry is-soon"><Icon name="clock" size={13} /> {t`Runs out on ${day} — renew it`}</span>;
  return <span className="pp-expiry"><Icon name="clock" size={13} /> {t`Valid until ${day}`}</span>;
}

/**
 * One kind of paper (§314): what it is and why, the one on record with its
 * state, and the form that adds or replaces it. `compact` for the setup
 * wizard, where the words are fewer.
 */
export function PaperSlot({
  kind,
  doc,
  compact = false,
  canEdit = true,
  onChanged,
  onCancelNew,
}: {
  kind: DocumentKind;
  /** The paper on record of this kind, if any. */
  doc: BusinessDocument | null;
  compact?: boolean;
  canEdit?: boolean;
  onChanged?: () => void;
  /** For a slot that was just added ("Add another paper"): closing it unused. */
  onCancelNew?: () => void;
}) {
  const words = PAPER_WORDS[kind];
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['readiness'] }),
      queryClient.invalidateQueries({ queryKey: ['today'] }),
    ]);

  const upload = useMutation({
    mutationFn: () => uploadDocument(kind, file!, { label: label.trim() || undefined, number: number.trim() || undefined, expiresAt: expiresAt || undefined }),
    onSuccess: async () => {
      setFile(null);
      setLabel('');
      setNumber('');
      setExpiresAt('');
      setReplacing(false);
      await refresh();
      onChanged?.();
    },
    onError: (error) => setProblem(said(error, t`The paper did not upload. Try again.`)),
  });

  const remove = useMutation({
    mutationFn: () => removeDocument(doc!.id),
    onSuccess: async () => {
      await refresh();
      onChanged?.();
    },
    onError: (error) => setProblem(said(error, t`That did not work.`)),
  });

  const askRemove = async () => {
    if (
      await confirmDialog({
        title: t`Remove this paper?`,
        body: <p><Trans>It is taken off your record. You can upload it again at any time.</Trans></p>,
        tone: 'danger',
        icon: 'trash',
        confirmLabel: t`Remove it`,
        cancelLabel: t`Keep it`,
      })
    ) {
      remove.mutate();
    }
  };

  const take = (files: File[]) => {
    setProblem(null);
    const { taken, problem: said } = sortFiles(files, PAPERS);
    if (said) setProblem(said);
    if (taken[0]) setFile(taken[0]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!file) return setProblem(t`Choose the file first.`);
    if (kind === 'OTHER' && label.trim().length < 3) return setProblem(t`Say what the paper is, in a few words.`);
    upload.mutate();
  };

  const showForm = canEdit && (!doc || replacing);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <article className={`pp-slot${compact ? ' is-compact' : ''}${doc?.status === 'REFUSED' || doc?.expired ? ' is-bad' : doc?.status === 'VERIFIED' ? ' is-ok' : ''}`}>
      <header className="pp-slot-head">
        <span className="pp-slot-icon">
          <Icon name={words.icon} size={18} />
        </span>
        <div className="pp-slot-title">
          <strong>{kind === 'OTHER' && doc?.label ? doc.label : words.name}</strong>
          {!compact && <em>{words.issuer || (kind === 'OTHER' ? t`Any other permit or certificate` : '')}</em>}
        </div>
        {doc && <StatusPill doc={doc} />}
      </header>
      {!compact && !doc && <p className="pp-slot-why">{words.why}</p>}

      {doc && (
        <div className="pp-doc">
          <div className="pp-doc-file">
            <Icon name={doc.mimeType === 'application/pdf' ? 'legal' : 'image'} size={16} />
            <span>
              <strong>{doc.fileName}</strong>
              <em>
                {sizeWords(doc.sizeBytes)} · {t`uploaded ${shortDay(doc.createdAt)}`}
                {doc.number ? ` · ${t`No. ${doc.number}`}` : ''}
              </em>
            </span>
          </div>
          <Expiry doc={doc} />
          {doc.status === 'REFUSED' && doc.refusalReason && (
            <p className="pp-refused">
              <Icon name="alert" size={15} />
              <span>
                <strong><Trans>Our team could not accept it:</Trans></strong> {doc.refusalReason}
              </span>
            </p>
          )}
          {doc.status === 'VERIFIED' && doc.checkedAt && (
            <p className="pp-checked">
              <Icon name="checkCircle" size={15} /> {t`Checked by our team on ${shortDay(doc.checkedAt)}`}
            </p>
          )}
          <div className="pp-doc-actions">
            <button type="button" onClick={() => openDocument(doc).catch((error) => setProblem(said(error, t`Could not open it.`)))}>
              <Icon name="external" size={15} />
              <Trans>Open it</Trans>
            </button>
            {canEdit && !replacing && (
              <button type="button" onClick={() => setReplacing(true)}>
                <Icon name="upload" size={15} />
                {doc.expired || doc.status === 'REFUSED' ? t`Upload a new one` : t`Replace`}
              </button>
            )}
            {canEdit && doc.status !== 'VERIFIED' && (
              <button type="button" className="danger" disabled={remove.isPending} onClick={() => void askRemove()}>
                <Icon name="trash" size={15} />
                <Trans>Remove</Trans>
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form className="pp-form" onSubmit={submit}>
          {kind === 'OTHER' && (
            <label className="pp-field">
              <span><Trans>What is it?</Trans></span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t`e.g. District operating permit`} />
            </label>
          )}
          <div className="pp-fields">
            <label className="pp-field">
              <span>
                <Trans>Number on it</Trans> <em><Trans>optional</Trans></em>
              </span>
              <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} placeholder={t`e.g. 102345678`} />
            </label>
            {words.expires && (
              <label className="pp-field">
                <span>
                  <Trans>Runs out on</Trans> <em><Trans>optional</Trans></em>
                </span>
                <input type="date" value={expiresAt} min={today} onChange={(e) => setExpiresAt(e.target.value)} />
              </label>
            )}
          </div>
          <DropZone onFiles={take} kind={PAPERS} hint={t`Drop the paper here`} className="pp-drop" noteInside>
            <button type="button" className="pp-pick" onClick={() => picker.current?.click()}>
              <Icon name={file ? 'checkCircle' : 'upload'} size={18} />
              <span>
                <strong>{file ? file.name : t`Choose the file`}</strong>
                <em>{file ? sizeWords(file.size) : t`PDF or a clear photo of the whole page — up to 15 MB`}</em>
              </span>
            </button>
            <input
              ref={picker}
              type="file"
              accept={PAPERS.extensions.join(',')}
              hidden
              onChange={(e) => {
                take(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </DropZone>
          {problem && (
            <p className="pp-problem" role="alert">
              <Icon name="alert" size={15} /> {problem}
            </p>
          )}
          <div className="pp-form-actions">
            {(replacing || onCancelNew) && (
              <button type="button" onClick={() => (replacing ? setReplacing(false) : onCancelNew?.())} disabled={upload.isPending}>
                <Trans>Cancel</Trans>
              </button>
            )}
            <button type="submit" className="primary" disabled={upload.isPending || !file}>
              {upload.isPending ? t`Uploading…` : replacing ? t`Replace it` : t`Upload`}
            </button>
          </div>
        </form>
      )}
      {!showForm && problem && (
        <p className="pp-problem" role="alert">
          <Icon name="alert" size={15} /> {problem}
        </p>
      )}
    </article>
  );
}
