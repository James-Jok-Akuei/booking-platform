import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { approveBusiness, type AdminBusinessDetail } from '../api/admin';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';

type Advice = AdminBusinessDetail['readiness']['advice'][number];

/** The longest note, as the server takes it (`ADVICE_NOTE_MAX`). */
const NOTE_MAX = 600;

/**
 * The approval notice's own words (`BUSINESS_APPROVED` in the backend's
 * notification-templates.ts, and `ADVICE_LEAD` in shop-advice.ts), so the
 * preview is what the shop will read. Change them together.
 */
const APPROVED = {
  subject: 'Your shop is approved',
  lead: 'Good news — your shop has been approved.',
  next:
    'Customers cannot see it yet. When you are ready, press "Post my shop" in your dashboard, and from then they can ' +
    'find your branches, see your times and book with you. Anything you would like to change first, you can change now.',
  advice:
    'Shops with clear, high-resolution photos and full details get booked far more often. Before you post, finish your ' +
    'shop by adding:',
};

/**
 * Approving a shop, with advice (§303).
 *
 * The things that would make it easier to book and are not in yet — a cover,
 * photos, a few lines, descriptions on its services — are listed already
 * ticked, in the words the shop will read; untick any not worth mentioning,
 * add a note in your own words, and the approval carries them: in the app, by
 * email as a checklist, and on the shop's dashboard until it posts. Nothing
 * here is needed to go live — that is checked before this opens.
 */
export function ApprovePanel({
  business,
  shopName,
  onBack,
  onClose,
}: {
  business: AdminBusinessDetail;
  shopName: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const missing = business.readiness.advice.filter((item) => !item.done);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(missing.map((item) => item.key)));
  const [note, setNote] = useState('');
  const chosen = missing.filter((item) => ticked.has(item.key));
  const words = note.trim();
  const advising = chosen.length > 0 || words.length > 0;

  const go = useMutation({
    mutationFn: () => approveBusiness(business.id, { advice: chosen.map((item) => item.key), ...(words ? { note: words } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
      void queryClient.invalidateQueries({ queryKey: ['business', business.id] });
      onBack();
    },
  });

  const flip = (key: string) =>
    setTicked((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const all = chosen.length === missing.length;

  return (
    <Panel
      eyebrow={shopName}
      title={business.status === 'REJECTED' ? 'Approve after all' : 'Approve the shop'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button type="button" onClick={onBack} disabled={go.isPending}>
            Back
          </button>
          <button type="button" className="primary" disabled={go.isPending} onClick={() => go.mutate()}>
            <Icon name="checkCircle" size={17} />
            {go.isPending ? 'Approving…' : advising ? 'Approve and send advice' : 'Approve'}
          </button>
        </>
      }
    >
      <ul className="ad-consequences">
        <li>
          <span className="ad-consequence-icon">
            <Icon name="mail" size={15} />
          </span>
          <span>The owner and their team are told in the app and by email{advising ? ', with your advice' : ''}.</span>
        </li>
        <li>
          <span className="ad-consequence-icon">
            <Icon name="eye" size={15} />
          </span>
          <span>Customers see nothing yet: the shop posts itself when it is ready.</span>
        </li>
      </ul>

      <section className="ap-section">
        <header className="ap-head">
          <div>
            <h3>Advice to send with it</h3>
            <p>
              {missing.length
                ? 'Not in yet, and each makes a shop easier to book. Ticked ones go in the message, in these words.'
                : 'Nothing to add — every photo and detail customers look for is in.'}
            </p>
          </div>
          {missing.length > 1 && (
            <button
              type="button"
              className="ap-all"
              onClick={() => setTicked(all ? new Set() : new Set(missing.map((item) => item.key)))}
            >
              {all ? 'Untick all' : 'Tick all'}
            </button>
          )}
        </header>
        {missing.length > 0 && (
          <div className="ap-items">
            {missing.map((item) => (
              <label key={item.key} className={`ap-item${ticked.has(item.key) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={ticked.has(item.key)} onChange={() => flip(item.key)} />
                <span className="ap-box" aria-hidden="true">
                  <Icon name="check" size={13} stroke={3} />
                </span>
                <span className="ap-words">
                  <strong>{item.title}</strong>
                  <span>{sentence(item.why)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <form className="ad-form ap-note" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>A note from you — optional, sent as you write it</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
            rows={3}
            maxLength={NOTE_MAX}
            placeholder="For example: your haircuts look great — a bright photo of the shop front would help people find you."
          />
          <small className="ap-count">
            {note.length}/{NOTE_MAX}
          </small>
        </label>
      </form>

      <section className="ap-section">
        <header className="ap-head">
          <div>
            <h3>What they will read</h3>
            <p>In the app, and as an email with a button to their dashboard.</p>
          </div>
        </header>
        <Letter chosen={chosen} note={words} />
      </section>

      {go.error && (
        <p className="error small" role="alert">
          {go.error instanceof ApiError ? go.error.message : 'That did not work.'}
        </p>
      )}
    </Panel>
  );
}

/** "the first thing customers see on your page" → "The first thing customers see on your page." */
const sentence = (why: string) => `${why.charAt(0).toUpperCase()}${why.slice(1)}${/[.!?]$/.test(why) ? '' : '.'}`;

/** The approval as the shop will read it — drawn like the email. */
function Letter({ chosen, note }: { chosen: Advice[]; note: string }) {
  return (
    <article className="ap-letter" aria-label="The message, as the shop will read it">
      <div className="ap-letter-top">
        <span className="ap-letter-mark">
          <Icon name="check" size={18} stroke={3} />
        </span>
        <span className="ap-letter-eyebrow">Your shop</span>
        <strong>{APPROVED.subject}</strong>
        <span>{APPROVED.lead}</span>
      </div>
      <div className="ap-letter-body">
        <p>{APPROVED.next}</p>
        {chosen.length > 0 && (
          <>
            <p>{APPROVED.advice}</p>
            <ul className="ap-letter-list">
              {chosen.map((item) => (
                <li key={item.key}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <em>{item.why}</em>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {note && (
          <blockquote>
            “{note.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')}”
            <cite>— Our review team</cite>
          </blockquote>
        )}
      </div>
    </article>
  );
}

/** What was advised when the shop was approved (§303), for whoever opens it next. */
export function AdviceSent({ business }: { business: AdminBusinessDetail }) {
  const sent = business.readiness.approvalAdvice;
  if (!sent) return null;
  const now = new Map(business.readiness.advice.map((item) => [item.key, item]));
  const at = new Date(sent.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="ap-sent">
      <p className="ap-sent-when">
        <Icon name="calendar" size={14} /> {at} · on their dashboard until they post the shop
      </p>
      {sent.keys.length > 0 && (
        <ul className="ap-sent-list">
          {sent.keys.map((key) => {
            const item = now.get(key);
            return (
              <li key={key} className={item?.done ? 'is-done' : ''}>
                <Icon name={item?.done ? 'checkCircle' : 'alert'} size={15} />
                <span>
                  {item?.title ?? key}
                  <em>{item?.done ? 'Done since' : 'Not yet'}</em>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {sent.note && <blockquote className="ap-sent-note">“{sent.note}”</blockquote>}
    </div>
  );
}
