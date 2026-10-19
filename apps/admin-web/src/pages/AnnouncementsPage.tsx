import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  announcementReach,
  cancelAnnouncement,
  createAnnouncement,
  getAnnouncement,
  listAdminCategories,
  listAdminPlaces,
  listAnnouncements,
  listBusinesses,
  listUsers,
  sendAnnouncement,
  testAnnouncement,
  updateAnnouncement,
  type Announcement,
  type AnnouncementDraft,
} from '../api/admin';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import './announcements.css';

type Kind = AnnouncementDraft['kind'];
type Audience = AnnouncementDraft['audience'];

const AUDIENCES: Array<{ value: Audience; label: string; icon: IconName }> = [
  { value: 'EVERYONE', label: 'Everyone — customers and sellers', icon: 'globe' },
  { value: 'CUSTOMERS', label: 'Customers', icon: 'users' },
  { value: 'SELLERS', label: 'Sellers', icon: 'store' },
  { value: 'ONE_SHOP', label: 'One shop’s team', icon: 'store' },
  { value: 'ONE_PERSON', label: 'One person', icon: 'user' },
];

const EMPTY: AnnouncementDraft = {
  kind: 'SERVICE',
  audience: 'CUSTOMERS',
  districtId: null,
  categoryId: null,
  userId: null,
  businessId: null,
  title: '',
  body: '',
  linkPath: null,
  linkLabel: null,
  sendPush: true,
  sendEmail: false,
  banner: false,
  bannerUntil: null,
};

const STATUS: Record<Announcement['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'quiet' },
  SCHEDULED: { label: 'Scheduled', tone: 'ask' },
  SENDING: { label: 'Sending', tone: 'warn' },
  SENT: { label: 'Sent', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'quiet' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "datetime-local" wants local time without a zone. */
const localInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Announcements (§287): one message to many people. A service notice reaches
 * everyone it is for; news reaches only those who said yes. Each person gets
 * it the ways they chose, with quiet hours kept — so the numbers beside the
 * form are who it reaches, and how, before anything is sent.
 */
export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['announcements'], queryFn: listAnnouncements, refetchInterval: 15_000 });
  const places = useQuery({ queryKey: ['admin-places'], queryFn: listAdminPlaces, staleTime: Infinity });
  const categories = useQuery({ queryKey: ['admin-categories'], queryFn: listAdminCategories, staleTime: 60_000 });

  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [later, setLater] = useState<string>('');
  const [narrow, setNarrow] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<AnnouncementDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // News cannot be a banner: it reaches only people who said yes.
  useEffect(() => {
    if (draft.kind === 'NEWS' && draft.banner) set({ banner: false, bannerUntil: null });
  }, [draft.kind, draft.banner]);

  // Who it reaches, asked again a moment after anything about it changes.
  const audienceKey = JSON.stringify([
    draft.kind,
    draft.audience,
    narrow ? draft.districtId : null,
    narrow ? draft.categoryId : null,
    draft.userId,
    draft.businessId,
    draft.sendPush,
    draft.sendEmail,
  ]);
  const [reachKey, setReachKey] = useState(audienceKey);
  useEffect(() => {
    const t = window.setTimeout(() => setReachKey(audienceKey), 350);
    return () => window.clearTimeout(t);
  }, [audienceKey]);
  const ready = draft.audience === 'ONE_PERSON' ? Boolean(draft.userId) : draft.audience === 'ONE_SHOP' ? Boolean(draft.businessId) : true;
  const payload = (): AnnouncementDraft => ({
    ...draft,
    title: draft.title.trim() || 'Untitled',
    body: draft.body.trim() || 'Not written yet.',
    districtId: narrow && draft.audience === 'CUSTOMERS' ? draft.districtId : null,
    categoryId: narrow && draft.audience === 'SELLERS' ? draft.categoryId : null,
    linkPath: draft.linkPath?.trim() || null,
    linkLabel: draft.linkLabel?.trim() || null,
    bannerUntil: draft.banner && draft.bannerUntil ? new Date(draft.bannerUntil).toISOString() : null,
  });
  const reach = useQuery({
    queryKey: ['announcement-reach', reachKey],
    queryFn: () => announcementReach(payload()),
    enabled: ready,
    placeholderData: (previous) => previous,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['announcements'] });
  const save = useMutation({
    mutationFn: async () => (editing ? updateAnnouncement(editing, payload()) : createAnnouncement(payload())),
    onSuccess: (a) => {
      setEditing(a.id);
      refresh();
    },
  });
  const test = useMutation({
    mutationFn: async () => {
      const a = await save.mutateAsync();
      return testAnnouncement(a.id);
    },
    onSuccess: (r) => setNote(r.message),
  });
  const send = useMutation({
    mutationFn: async (confirmCount?: number) => {
      const a = await save.mutateAsync();
      return sendAnnouncement(a.id, { ...(later ? { at: new Date(later).toISOString() } : {}), ...(confirmCount ? { confirmCount } : {}) });
    },
    onSuccess: (a) => {
      setNote(a.status === 'SCHEDULED' ? `Scheduled for ${when(a.scheduledFor!)}.` : 'On its way.');
      setDraft(EMPTY);
      setEditing(null);
      setLater('');
      setNarrow(false);
      setPicked(null);
      setOpen(a.id);
      refresh();
    },
  });
  const cancel = useMutation({ mutationFn: cancelAnnouncement, onSuccess: refresh });

  const r = reach.data;
  const canSend = ready && draft.title.trim().length >= 3 && draft.body.trim().length >= 3 && (r?.people ?? 0) > 0;

  const onSend = async () => {
    if (!r) return;
    const how = [r.push ? `${r.push.toLocaleString()} by alert` : null, r.email ? `${r.email.toLocaleString()} by email` : null]
      .filter(Boolean)
      .join(', ');
    let confirmCount: number | undefined;
    if (r.people > r.confirmAbove) {
      const typed = await promptDialog({
        title: `Send to ${r.people.toLocaleString()} people?`,
        body: (
          <p>
            {later ? `On ${when(new Date(later).toISOString())}` : 'Now'}, into their notifications{how ? ` — ${how}` : ''}. Type the number of
            people to confirm.
          </p>
        ),
        label: 'Number of people',
        placeholder: String(r.people),
        tone: 'warn',
        icon: 'megaphone',
        confirmLabel: later ? 'Schedule it' : 'Send it',
      });
      if (typed === null) return;
      confirmCount = Number(typed.replace(/\D/g, ''));
    } else {
      const ok = await confirmDialog({
        title: `Send to ${r.people.toLocaleString()} ${r.people === 1 ? 'person' : 'people'}?`,
        body: (
          <p>
            {later ? `On ${when(new Date(later).toISOString())}` : 'Now'}, into their notifications{how ? ` — ${how}` : ''}. It cannot be taken
            back once sent.
          </p>
        ),
        tone: 'accent',
        icon: 'megaphone',
        confirmLabel: later ? 'Schedule it' : 'Send it',
      });
      if (!ok) return;
    }
    send.mutate(confirmCount);
  };

  const load = (a: Announcement) => {
    setOpen(a.id);
    if (a.status !== 'DRAFT' && a.status !== 'SCHEDULED') return;
    setEditing(a.id);
    setDraft({
      kind: a.kind,
      audience: a.audience,
      districtId: a.district?.id ?? null,
      categoryId: a.category?.id ?? null,
      userId: a.user?.id ?? null,
      businessId: a.business?.id ?? null,
      title: a.title,
      body: a.body,
      linkPath: a.linkPath,
      linkLabel: a.linkLabel,
      sendPush: a.sendPush,
      sendEmail: a.sendEmail,
      banner: a.banner,
      bannerUntil: a.bannerUntil ? localInput(a.bannerUntil) : null,
    });
    setNarrow(Boolean(a.district || a.category));
    setLater(a.scheduledFor ? localInput(a.scheduledFor) : '');
    setPicked(a.user ? { id: a.user.id, label: a.user.displayName ?? a.user.email } : a.business ? { id: a.business.id, label: a.business.name } : null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const districts = useMemo(
    () =>
      (places.data ?? []).flatMap((p) => p.districts.map((d) => ({ value: d.id, label: d.name, group: p.name }))),
    [places.data],
  );
  const error = save.error ?? send.error ?? test.error;

  return (
    <section className="an">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Announcements</h1>
            <p className="muted">
              Write to many people at once. A service notice reaches everyone it is for; news reaches only people who said yes. Each person
              gets it the ways they chose, with their quiet hours kept.
            </p>
          </div>
        </header>
      </div>

      <div className="an-layout">
        <article className="an-card an-compose">
          <header className="an-compose-head">
            <h2>{editing ? 'Editing a draft' : 'New announcement'}</h2>
            {editing && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                  setLater('');
                  setPicked(null);
                  setNarrow(false);
                }}
              >
                Start a new one
              </button>
            )}
          </header>

          <div className="an-kinds" role="radiogroup" aria-label="Kind">
            {(
              [
                { value: 'SERVICE', icon: 'shield', title: 'Service notice', line: 'Something people need to know. Reaches everyone it is for.' },
                { value: 'NEWS', icon: 'sparkles', title: 'News and offers', line: 'New places, deals, tips. Only people who said yes get it.' },
              ] as Array<{ value: Kind; icon: IconName; title: string; line: string }>
            ).map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={draft.kind === k.value}
                className={`an-kind${draft.kind === k.value ? ' is-on' : ''} kind-${k.value.toLowerCase()}`}
                onClick={() => set({ kind: k.value })}
              >
                <span className="an-kind-mark">
                  <Icon name={k.icon} size={18} />
                </span>
                <strong>{k.title}</strong>
                <span>{k.line}</span>
              </button>
            ))}
          </div>

          <div className="an-field">
            <span>Who it is for</span>
            <Select
              value={draft.audience}
              options={AUDIENCES}
              onChange={(audience) => {
                set({ audience, userId: null, businessId: null });
                setPicked(null);
                setNarrow(false);
              }}
              label="Who it is for"
            />
          </div>

          {(draft.audience === 'CUSTOMERS' || draft.audience === 'SELLERS') && (
            <div className="an-narrow">
              <label className="an-check">
                <input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} />
                {draft.audience === 'CUSTOMERS' ? 'Only customers in one district' : 'Only sellers of one category'}
              </label>
              {narrow && draft.audience === 'CUSTOMERS' && (
                <Select
                  value={draft.districtId ?? ''}
                  options={districts}
                  onChange={(districtId) => set({ districtId })}
                  placeholder="Choose a district"
                  searchable
                  label="District"
                />
              )}
              {narrow && draft.audience === 'SELLERS' && (
                <Select
                  value={draft.categoryId ?? ''}
                  options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(categoryId) => set({ categoryId })}
                  placeholder="Choose a category"
                  label="Category"
                />
              )}
            </div>
          )}

          {draft.audience === 'ONE_PERSON' && (
            <Finder
              kind="person"
              picked={picked}
              onPick={(p) => {
                setPicked(p);
                set({ userId: p?.id ?? null });
              }}
            />
          )}
          {draft.audience === 'ONE_SHOP' && (
            <Finder
              kind="shop"
              picked={picked}
              onPick={(p) => {
                setPicked(p);
                set({ businessId: p?.id ?? null });
              }}
            />
          )}

          <label className="an-field">
            <span>
              Title <em>{draft.title.length}/80</em>
            </span>
            <input value={draft.title} maxLength={80} placeholder="MTN MoMo is slow this morning" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="an-field">
            <span>
              Message <em>{draft.body.length}/1000</em>
            </span>
            <textarea
              rows={4}
              value={draft.body}
              maxLength={1000}
              placeholder="Payments may take a few minutes to confirm. Nothing is lost — if a payment is slow, wait before trying again."
              onChange={(e) => set({ body: e.target.value })}
            />
          </label>
          <div className="an-two">
            <label className="an-field">
              <span>Opens (optional)</span>
              <input value={draft.linkPath ?? ''} placeholder="/stories" onChange={(e) => set({ linkPath: e.target.value })} />
            </label>
            <label className="an-field">
              <span>Button words</span>
              <input value={draft.linkLabel ?? ''} maxLength={30} placeholder="Have a look" onChange={(e) => set({ linkLabel: e.target.value })} />
            </label>
          </div>

          <div className="an-ways">
            <div className="an-way is-locked">
              <Icon name="bell" size={16} />
              <span>
                <strong>In their notifications</strong>
                <em>Everyone it reaches</em>
              </span>
            </div>
            <div className="an-way">
              <Icon name="phone" size={16} />
              <span>
                <strong>As an alert</strong>
                <em>To people with alerts on</em>
              </span>
              <Switch checked={draft.sendPush} label="Send as an alert" onChange={(sendPush) => set({ sendPush })} />
            </div>
            <div className="an-way">
              <Icon name="mail" size={16} />
              <span>
                <strong>By email</strong>
                <em>{draft.kind === 'NEWS' ? 'To people who said yes by email' : 'To everyone it is for'}</em>
              </span>
              <Switch checked={draft.sendEmail} label="Send by email" onChange={(sendEmail) => set({ sendEmail })} />
            </div>
            <div className={`an-way${draft.kind === 'NEWS' ? ' is-off' : ''}`}>
              <Icon name="megaphone" size={16} />
              <span>
                <strong>A banner across the app</strong>
                <em>{draft.kind === 'NEWS' ? 'For service notices only' : 'Until a date — a week if none'}</em>
              </span>
              <Switch
                checked={draft.banner}
                disabled={draft.kind === 'NEWS' || draft.audience === 'ONE_PERSON' || draft.audience === 'ONE_SHOP'}
                label="Also a banner"
                onChange={(banner) => set({ banner })}
              />
            </div>
            {draft.banner && (
              <label className="an-field an-until">
                <span>Banner until</span>
                <input type="datetime-local" value={draft.bannerUntil ?? ''} onChange={(e) => set({ bannerUntil: e.target.value || null })} />
              </label>
            )}
          </div>

          <div className="an-when">
            <div className="an-when-pick" role="radiogroup" aria-label="When">
              <button type="button" role="radio" aria-checked={!later} className={!later ? 'is-on' : ''} onClick={() => setLater('')}>
                Now
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={Boolean(later)}
                className={later ? 'is-on' : ''}
                onClick={() => setLater(localInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()))}
              >
                Later
              </button>
            </div>
            {later && <input type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)} aria-label="Send at" />}
          </div>

          {error && (
            <p className="error an-error" role="alert">
              <Icon name="alert" size={15} />
              {error instanceof ApiError ? error.message : 'That did not work.'}
            </p>
          )}
          {note && (
            <p className="an-note" role="status">
              <Icon name="checkCircle" size={15} /> {note}
            </p>
          )}

          <footer className="an-actions">
            <button type="button" disabled={save.isPending || !ready} onClick={() => save.mutate(undefined, { onSuccess: () => setNote('Saved as a draft.') })}>
              Save draft
            </button>
            <button type="button" disabled={test.isPending || !ready || draft.title.trim().length < 3} onClick={() => test.mutate()}>
              <Icon name="send" size={15} /> Send a test to me
            </button>
            <button type="button" className="primary" disabled={!canSend || send.isPending} onClick={() => void onSend()}>
              <Icon name="megaphone" size={16} />
              {send.isPending ? 'Sending…' : later ? 'Schedule' : `Send to ${(r?.people ?? 0).toLocaleString()}`}
            </button>
          </footer>
        </article>

        <aside className="an-side">
          <article className={`an-card an-reach${reach.isFetching ? ' is-counting' : ''}`}>
            <span className="an-reach-label">It reaches</span>
            <strong>{ready ? (r ? r.people.toLocaleString() : '—') : '—'}</strong>
            <span className="an-reach-word">{ready ? (r?.people === 1 ? 'person' : 'people') : 'Choose who first'}</span>
            <ul>
              <li>
                <Icon name="phone" size={14} /> <b>{r?.push.toLocaleString() ?? 0}</b> by alert
              </li>
              <li>
                <Icon name="mail" size={14} /> <b>{r?.email.toLocaleString() ?? 0}</b> by email
              </li>
              {r && r.left > 0 && (
                <li className="is-left">
                  <Icon name="lock" size={14} /> <b>{r.left.toLocaleString()}</b> left out — {draft.kind === 'NEWS' ? 'no yes to news' : 'account closed'}
                </li>
              )}
            </ul>
          </article>

          <div className="an-preview">
            <div className="an-phone">
              <div className="an-alert">
                <div className="an-alert-app">
                  <span className="an-alert-icon" aria-hidden="true" />
                  <span>BOOKING</span>
                  <small>now</small>
                </div>
                <strong>{draft.title.trim() || 'Your title'}</strong>
                <p>{draft.body.trim() || 'Your message, as people will see it.'}</p>
              </div>
            </div>
            {draft.sendEmail && (
              <div className="an-email">
                <span className="an-email-bar" />
                <em>From our team</em>
                <strong>{draft.title.trim() || 'Your title'}</strong>
                <p>{draft.body.trim() || 'Your message.'}</p>
                {draft.linkPath && <span className="an-email-btn">{draft.linkLabel || 'Open'} →</span>}
                <small>
                  {draft.kind === 'NEWS'
                    ? 'You get emails about news and offers because they are turned on. Stop emails like this'
                    : 'You always get emails about your account and service notices.'}
                </small>
              </div>
            )}
          </div>
        </aside>
      </div>

      <article className="an-card an-history">
        <header className="an-history-head">
          <h2>Sent and planned</h2>
          <span>{list.data?.announcements.length ?? 0}</span>
        </header>
        {list.data && list.data.announcements.length === 0 && (
          <div className="an-empty">
            <Icon name="megaphone" size={26} />
            <p>Nothing yet. What you send shows here, with how many it reached and how many read it.</p>
          </div>
        )}
        <ul>
          {list.data?.announcements.map((a, i) => (
            <HistoryRow
              key={a.id}
              a={a}
              index={i}
              open={open === a.id}
              onOpen={() => (open === a.id ? setOpen(null) : load(a))}
              onCancel={() => cancel.mutate(a.id)}
            />
          ))}
        </ul>
      </article>
    </section>
  );
}

function audienceWords(a: Announcement) {
  switch (a.audience) {
    case 'EVERYONE':
      return 'Everyone';
    case 'CUSTOMERS':
      return a.district ? `Customers in ${a.district.name}` : 'All customers';
    case 'SELLERS':
      return a.category ? `${a.category.name} sellers` : 'All sellers';
    case 'ONE_SHOP':
      return a.business?.name ?? 'One shop';
    case 'ONE_PERSON':
      return a.user?.displayName ?? a.user?.email ?? 'One person';
  }
}

function HistoryRow({
  a,
  index,
  open,
  onOpen,
  onCancel,
}: {
  a: Announcement;
  index: number;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const detail = useQuery({
    queryKey: ['announcement', a.id],
    queryFn: () => getAnnouncement(a.id),
    enabled: open && a.status !== 'DRAFT',
    refetchInterval: open && (a.status === 'SENDING' || a.status === 'SENT') ? 10_000 : false,
  });
  const s = detail.data?.stats;
  const look = STATUS[a.status];
  return (
    <li className={`an-row${open ? ' is-open' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <button type="button" className="an-row-head" onClick={onOpen} aria-expanded={open}>
        <span className={`an-row-kind kind-${a.kind.toLowerCase()}`} aria-hidden="true">
          <Icon name={a.kind === 'NEWS' ? 'sparkles' : 'shield'} size={15} />
        </span>
        <span className="an-row-text">
          <strong>{a.title}</strong>
          <span>
            {audienceWords(a)} · {a.sentAt ? `sent ${when(a.sentAt)}` : a.scheduledFor ? `for ${when(a.scheduledFor)}` : `written ${when(a.createdAt)}`}
            {a.sentAt && ` · ${a.recipients.toLocaleString()} people`}
          </span>
        </span>
        <span className={`an-chip tone-${look.tone}`}>{look.label}</span>
      </button>
      {open && (
        <div className="an-row-body">
          <p>{a.body}</p>
          {s && (
            <div className="an-stats">
              <span>
                <b>{s.recipients.toLocaleString()}</b> reached
              </span>
              <span>
                <b>{s.read.toLocaleString()}</b> read
              </span>
              <span>
                <b>{s.pushSent.toLocaleString()}</b> alerts
              </span>
              <span>
                <b>{s.emailSent.toLocaleString()}</b> emails
              </span>
              {s.waiting > 0 && (
                <span className="is-wait">
                  <b>{s.waiting.toLocaleString()}</b> waiting for quiet hours
                </span>
              )}
              {s.pushFailed + s.emailFailed > 0 && (
                <span className="is-bad">
                  <b>{(s.pushFailed + s.emailFailed).toLocaleString()}</b> failed
                </span>
              )}
            </div>
          )}
          <span className="an-row-by">
            {a.sentBy ? `Sent by ${a.sentBy}` : a.createdBy ? `Written by ${a.createdBy}` : ''}
            {a.banner && ' · also a banner'}
          </span>
          {a.status === 'SCHEDULED' && (
            <button type="button" className="danger an-row-cancel" onClick={onCancel}>
              Cancel it
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Finds the one person, or the one shop, it is for. */
function Finder({
  kind,
  picked,
  onPick,
}: {
  kind: 'person' | 'shop';
  picked: { id: string; label: string } | null;
  onPick: (p: { id: string; label: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(typed.trim()), 300);
    return () => window.clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: ['an-finder', kind, q],
    enabled: q.length >= 2,
    queryFn: async () =>
      kind === 'person'
        ? (await listUsers({ search: q, limit: 6 })).users
            .filter((u) => u.role !== 'ADMIN' && !u.closedAt)
            .map((u) => ({ id: u.id, label: u.displayName ?? u.email, hint: u.displayName ? u.email : u.role.toLowerCase() }))
        : (await listBusinesses({ q, status: 'APPROVED', limit: 6 })).businesses.map((b) => ({
            id: b.id,
            label: b.name ?? 'Unnamed shop',
            hint: 'Its whole team',
          })),
  });

  if (picked) {
    return (
      <div className="an-picked">
        <Icon name={kind === 'person' ? 'user' : 'store'} size={16} />
        <strong>{picked.label}</strong>
        <button type="button" className="link" onClick={() => onPick(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="an-finder">
      <label className="an-field">
        <span>{kind === 'person' ? 'Find the person' : 'Find the shop'}</span>
        <input value={typed} placeholder={kind === 'person' ? 'A name or an email' : 'The shop’s name'} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {found.data && found.data.length > 0 && (
        <ul>
          {found.data.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => onPick({ id: f.id, label: f.label })}>
                <strong>{f.label}</strong>
                <span>{f.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {found.data && found.data.length === 0 && <p className="muted small">Nobody found for “{q}”.</p>}
    </div>
  );
}
