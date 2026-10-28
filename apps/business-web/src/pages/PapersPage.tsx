import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listDocuments, type BusinessDocument, type DocumentKind, type PaperRule } from '../api/business';
import { useAccess } from '../access';
import { PaperSlot } from '../papers/PaperSlot';
import { PAPER_WORDS, REGISTRATION_KINDS, RULE_WORDS } from '../papers/words';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import '../papers/papers.css';

/** Where the shop stands on one licence it must hold, as a pill. */
function RulePill({ state }: { state: PaperRule['state'] }) {
  if (state === 'checked') return <span className="pill verified"><Trans>Checked</Trans></span>;
  if (state === 'waiting') return <span className="pill pending"><Trans>Waiting for our team</Trans></span>;
  return <span className="pill rejected"><Trans>Missing</Trans></span>;
}

/**
 * Business papers (§314): the shop's registration — which earns the
 * "Registered business" mark customers see — and, for a licensed trade, the
 * licence it cannot go live without. Only the owner and every-branch
 * managers come here; the files are opened through the sign-in, never a link.
 */
export function PapersPage() {
  const access = useAccess();
  const papers = useQuery({ queryKey: ['documents'], queryFn: listDocuments });
  const [adding, setAdding] = useState<DocumentKind | null>(null);
  const data = papers.data;
  const canEdit = access.runsBusiness;

  const byKind = new Map<DocumentKind, BusinessDocument>();
  for (const doc of data?.documents ?? []) if (doc.kind !== 'OTHER' && !byKind.has(doc.kind)) byKind.set(doc.kind, doc);
  const others = (data?.documents ?? []).filter((d) => d.kind === 'OTHER');

  const required = data?.required ?? [];
  const requiredKinds = new Set(required.flatMap((rule) => rule.kinds));
  // Everything else a shop may upload, for "Add another paper".
  const shownKinds = new Set<DocumentKind>([...requiredKinds, ...REGISTRATION_KINDS]);
  const extraKinds = (Object.keys(PAPER_WORDS) as DocumentKind[]).filter((k) => !shownKinds.has(k) && (k === 'OTHER' || !byKind.has(k)));
  const extraDocs = (data?.documents ?? []).filter((d) => d.kind !== 'OTHER' && !shownKinds.has(d.kind));

  return (
    <section className="pp">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>Business papers</Trans></h1>
            <p className="muted">
              <Trans>Your registration and the licences your kind of shop needs. Only you and our team can open them.</Trans>
            </p>
          </div>
        </header>
      </div>

      {papers.isLoading && <div className="skeleton pp-skeleton" />}

      {data && !data.canUpload && (
        <p className="notice pp-notice" role="alert">
          <Icon name="alert" size={16} />
          <Trans>Papers cannot be kept on this server yet — our team has been told. Try again later.</Trans>
        </p>
      )}

      {data && (
        <>
          {/* The mark (§314): what customers see on the shop's page. */}
          <article className={`pp-mark${data.registered ? ' is-on' : ''}`}>
            <span className="pp-mark-badge">
              <Icon name={data.registered ? 'checkCircle' : 'shield'} size={22} />
            </span>
            <div>
              <strong>{data.registered ? t`Registered business ✓` : t`Earn the “Registered business” mark`}</strong>
              <p>
                {data.registered
                  ? t`Customers see this mark on your page: our team checked your registration. Keep a paper that runs out renewed, and the mark stays.`
                  : t`Upload your RDB certificate, your TIN or your trading licence. Once our team checks it, customers see the mark on your page — and it ranks you a little higher.`}
              </p>
            </div>
          </article>

          {required.length > 0 && (
            <section className="pp-group">
              <h2>
                <Icon name="shield" size={17} />
                <Trans>Required for your kind of shop</Trans>
              </h2>
              <p className="muted">
                <Trans>Your shop cannot be sent for review without it, and goes live once our team has checked it.</Trans>
              </p>
              {required.map((rule) => (
                <div key={rule.key} className="pp-rule">
                  <div className="pp-rule-head">
                    <strong>{RULE_WORDS[rule.key]}</strong>
                    <RulePill state={rule.state} />
                  </div>
                  {rule.kinds.length > 1 && <p className="muted small"><Trans>Any one of these is enough.</Trans></p>}
                  <div className="pp-slots">
                    {rule.kinds.map((kind) => (
                      <PaperSlot key={kind} kind={kind} doc={byKind.get(kind) ?? null} canEdit={canEdit} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="pp-group">
            <h2>
              <Icon name="legal" size={17} />
              <Trans>Your registration</Trans>
            </h2>
            <p className="muted"><Trans>Any one of these earns the mark once checked. A company’s RDB certificate carries its TIN too.</Trans></p>
            <div className="pp-slots">
              {REGISTRATION_KINDS.map((kind) => (
                <PaperSlot key={kind} kind={kind} doc={byKind.get(kind) ?? null} canEdit={canEdit} />
              ))}
            </div>
          </section>

          <section className="pp-group">
            <h2>
              <Icon name="paperclip" size={17} />
              <Trans>Other papers</Trans>
            </h2>
            {extraDocs.length === 0 && others.length === 0 && !adding && (
              <EmptyState
                size="row"
                art="paper"
                title={t`Nothing else on record`}
                text={t`A licence from Rwanda FDA or the tourism board, a permit, a certificate — anything you want us to have.`}
              />
            )}
            <div className="pp-slots">
              {extraDocs.map((doc) => (
                <PaperSlot key={doc.id} kind={doc.kind} doc={doc} canEdit={canEdit} />
              ))}
              {others.map((doc) => (
                <PaperSlot key={doc.id} kind="OTHER" doc={doc} canEdit={canEdit} />
              ))}
              {adding && <PaperSlot kind={adding} doc={null} canEdit={canEdit} onChanged={() => setAdding(null)} onCancelNew={() => setAdding(null)} />}
            </div>
            {canEdit && !adding && (
              <div className="pp-add">
                <Select
                  value=""
                  onChange={(kind) => kind && setAdding(kind as DocumentKind)}
                  label={t`Add another paper`}
                  options={[{ value: '', label: t`Add another paper…` }, ...extraKinds.map((kind) => ({ value: kind, label: PAPER_WORDS[kind].name }))]}
                />
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
