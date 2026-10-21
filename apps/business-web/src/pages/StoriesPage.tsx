import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { deleteStory, getProfile, listLocations, listMyStories, postStory, type BusinessStory } from '../api/business';
import { useAccess } from '../access';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { DropZone } from '../ui/DropZone';
import { ShopLogo } from '../ui/ShopLogo';
import './stories.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

const CAPTION_MAX = 150;
/** Words to start from, for any kind of shop; a tap puts one in the box. */
const IDEAS = () => [
  t`Free this afternoon — book now`,
  t`Something we did today`,
  t`New this week — book it in the app`,
  t`Open late tonight`,
];
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
/** What the server takes for a story: the same photos as a shop's gallery. */
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 15;

/** Why a file cannot be a story, in words — or null when it can. */
function refusal(file: File): string | null {
  if (file.type.startsWith('video/')) return t`A story is a photo — a video cannot go up. Choose a JPG, PNG or WebP.`;
  if (!TYPES.includes(file.type)) {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : null;
    return ext ? t`A story takes a JPG, PNG or WebP photo. This one is a .${ext} file.` : t`A story takes a JPG, PNG or WebP photo.`;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    const size = Math.ceil(file.size / (1024 * 1024));
    return t`That photo is ${size} MB. A story takes one up to ${MAX_MB} MB.`;
  }
  return null;
}

/** "13h 20m left", "45m left". */
function left(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return t`Ended`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? t`${h}h ${m}m left` : t`${m}m left`;
}

/**
 * Stories (§285): a photo and a few words for today — "fresh braids", "two
 * slots free this afternoon" — at the top of the customer app for 24 hours,
 * with a Book button that leads straight to the shop.
 *
 * Posted with one press, and live at once: what is in the phone beside the
 * form is exactly what customers will see. The owner and managers post (a
 * manager of some branches, for theirs — §277); everyone can see them.
 */
export function StoriesPage() {
  const access = useAccess();
  const queryClient = useQueryClient();
  const stories = useQuery({ queryKey: ['stories'], queryFn: listMyStories, refetchInterval: 60_000 });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const all = stories.data?.stories ?? [];
  const live = all.filter((s) => !s.removedAt && Date.parse(s.expiresAt) > now);
  const ended = all.filter((s) => s.removedAt || Date.parse(s.expiresAt) <= now);
  const p = profile.data;
  const shopLive = p ? p.status === 'APPROVED' && Boolean(p.publishedAt) && !p.pausedAt : true;

  const remove = useMutation({
    mutationFn: deleteStory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stories'] }),
  });
  const askRemove = async (story: BusinessStory) => {
    if (
      await confirmDialog({
        title: t`Take this story down?`,
        body: <p><Trans>Customers stop seeing it straight away. It cannot be brought back — you can post it again.</Trans></p>,
        tone: 'danger',
        icon: 'trash',
        confirmLabel: t`Take it down`,
      })
    ) {
      remove.mutate(story.id);
    }
  };

  return (
    <section className="sto">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>Stories</Trans></h1>
            <p className="muted">
              <Trans>
                A photo and a few words for today. Customers see it at the top of the app for 24 hours, with a Book button
                that brings them straight to you.
              </Trans>
            </p>
          </div>
        </header>
      </div>

      {!shopLive && (
        <p className="sto-note">
          <Icon name="info" size={16} />
          <Trans>
            Customers see your stories once your shop is live. You can post them now — they
            show as soon as it is.
          </Trans>
        </p>
      )}

      <div className="sto-layout">
        {access.runsBranches ? (
          <Composer
            postedToday={stories.data?.postedToday ?? 0}
            dailyLimit={stories.data?.dailyLimit ?? 10}
            shopName={p?.name ?? t`Your shop`}
            logoUrl={p?.logoUrl ?? null}
            branches={(locations.data ?? []).filter((l) => l.isActive && access.sees(l.id))}
            wholeShop={access.allBranches}
            onPosted={() => queryClient.invalidateQueries({ queryKey: ['stories'] })}
          />
        ) : (
          <aside className="sto-card sto-readonly">
            <Icon name="shield" size={18} />
            <p><Trans>The owner or a manager posts stories. You can see them here.</Trans></p>
          </aside>
        )}

        <div className="sto-lists">
          <article className="sto-card">
            <header className="sto-card-head">
              <h2><Trans>Live now</Trans></h2>
              <span>{live.length}</span>
            </header>
            {stories.isLoading && <div className="skeleton sto-skeleton" />}
            {stories.data && live.length === 0 && (
              <div className="sto-empty">
                <span className="sto-empty-ring">
                  <Icon name="stories" size={28} />
                </span>
                <strong><Trans>No story up right now</Trans></strong>
                <p><Trans>A shop with a story gets a coral ring in the app — the first thing customers tap.</Trans></p>
              </div>
            )}
            <div className="sto-grid">
              {live.map((story, i) => (
                <StoryTile
                  key={story.id}
                  story={story}
                  index={i}
                  note={left(story.expiresAt, now)}
                  canRemove={
                    access.runsBranches && (story.location ? access.sees(story.location.id) : access.allBranches)
                  }
                  busy={remove.isPending}
                  onRemove={() => void askRemove(story)}
                />
              ))}
            </div>
          </article>

          {ended.length > 0 && (
            <article className="sto-card is-quiet">
              <header className="sto-card-head">
                <h2><Trans>Ended</Trans></h2>
                <span>{ended.length}</span>
              </header>
              <div className="sto-grid">
                {ended.map((story, i) => (
                  <StoryTile
                    key={story.id}
                    story={story}
                    index={i}
                    note={story.removedAt ? t`Taken down` : t`Ended`}
                    ended
                    canRemove={false}
                    busy={false}
                    onRemove={() => undefined}
                  />
                ))}
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

/** Choosing the photo and the words, beside a phone showing exactly what customers will see. */
function Composer({
  postedToday,
  dailyLimit,
  shopName,
  logoUrl,
  branches,
  wholeShop,
  onPosted,
}: {
  postedToday: number;
  dailyLimit: number;
  shopName: string;
  logoUrl: string | null;
  branches: Array<{ id: string; name: string }>;
  wholeShop: boolean;
  onPosted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [where, setWhere] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // Someone with some branches posts for one of theirs; the first is chosen for them.
  const branchId = where ?? (wholeShop ? null : (branches[0]?.id ?? null));
  const full = postedToday >= dailyLimit;

  const post = useMutation({
    mutationFn: () => postStory(file!, caption, branchId),
    onSuccess: () => {
      setFile(null);
      setCaption('');
      setDone(true);
      window.setTimeout(() => setDone(false), 3500);
      onPosted();
    },
  });

  // Checked here, so a wrong file is explained at once rather than after an upload.
  const pick = (picked: File | undefined) => {
    if (!picked) return;
    setDone(false);
    post.reset();
    const why = refusal(picked);
    setRefused(why);
    if (!why) setFile(picked);
  };

  const place = branchId ? branches.find((b) => b.id === branchId)?.name : null;

  return (
    <aside className="sto-composer">
      {/* What customers will see, as they will see it. */}
      {/* Dropped like every other photo in the app (§305). */}
      <DropZone className="sto-drop" onFiles={([file]) => pick(file)} hint={preview ? t`Drop to use this photo instead` : t`Drop to use this photo`}>
      <div className={`sto-phone${preview ? ' has-photo' : ''}`}>
        {preview ? (
          <>
            <img className="sto-phone-blur" src={preview} alt="" aria-hidden="true" />
            <img className="sto-phone-photo" src={preview} alt={t`Your story`} />
          </>
        ) : (
          <label className="sto-pick" htmlFor="story-photo">
            <span className="sto-pick-icon">
              <Icon name="camera" size={26} />
            </span>
            <strong><Trans>Choose a photo</Trans></strong>
            <span><Trans>or drop one here</Trans></span>
            <small><Trans>JPG, PNG or WebP · up to {MAX_MB} MB</Trans></small>
          </label>
        )}
        <div className="sto-phone-top">
          <div className="sto-bars">
            <i className="is-on" />
          </div>
          <div className="sto-phone-who">
            <ShopLogo logoUrl={logoUrl} name={shopName} size={30} />
            <span>
              <b>{shopName}</b>
              <small>{place ? t`${place} · now` : t`now`}</small>
            </span>
          </div>
        </div>
        {(caption.trim() || preview) && (
          <div className="sto-phone-foot">
            {caption.trim() && <p>{caption.trim()}</p>}
            <span className="sto-book"><Trans>Book at </Trans>{place ?? shopName}</span>
          </div>
        )}
        {preview && (
          <label className="sto-change" htmlFor="story-photo">
            <Icon name="image" size={15} />{' '}
            <Trans>Change photo</Trans>
          </label>
        )}
        <input
          id="story-photo"
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      </DropZone>

      <div className="sto-form">
        <label className="sto-field">
          <span>
            <Trans>
              A few words{' '}
              <em>
              {caption.length}/{CAPTION_MAX}
              </em>
            </Trans>
          </span>
          <textarea
            rows={2}
            maxLength={CAPTION_MAX}
            value={caption}
            placeholder={t`Two slots free this afternoon — book now`}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>

        {(branches.length > 1 || (!wholeShop && branches.length > 0)) && (
          <div className="sto-field">
            <span><Trans>About</Trans></span>
            <div className="sto-where" role="radiogroup" aria-label={t`Which branch`}>
              {wholeShop && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={branchId === null}
                  className={branchId === null ? 'is-on' : ''}
                  onClick={() => setWhere(null)}
                >
                  <Icon name="store" size={14} />{' '}
                  <Trans>The whole shop</Trans>
                </button>
              )}
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={branchId === b.id}
                  className={branchId === b.id ? 'is-on' : ''}
                  onClick={() => setWhere(b.id)}
                >
                  <Icon name="pin" size={14} /> {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sto-meter" aria-label={t`${postedToday} of ${dailyLimit} stories posted today`}>
          <span>
            <Trans>{postedToday} of {dailyLimit} today</Trans>
          </span>
          <i>
            <b style={{ width: `${Math.min(100, (postedToday / dailyLimit) * 100)}%` }} />
          </i>
        </div>

        {(refused || post.error) && (
          <p className="sto-problem" role="alert">
            <Icon name="alert" size={15} />
            {refused ??
              (post.error instanceof ApiError ? post.error.message : t`That did not post. Check your connection.`)}
          </p>
        )}
        {done && (
          <p className="sto-done" role="status">
            <Icon name="checkCircle" size={16} />{' '}
            <Trans>Posted — live for 24 hours.</Trans>
          </p>
        )}

        <button
          type="button"
          className="primary sto-post"
          disabled={!file || post.isPending || full}
          onClick={() => post.mutate()}
        >
          <Icon name="send" size={16} />
          {post.isPending ? t`Posting…` : full ? t`Ten posted today` : t`Post story`}
        </button>

        <div className="sto-ideas">
          <span>
            <Icon name="sparkles" size={14} />{' '}
            <Trans>Need words? Tap one</Trans>
          </span>
          <div>
            {IDEAS().map((idea) => (
              <button key={idea} type="button" onClick={() => setCaption(idea)}>
                {idea}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function StoryTile({
  story,
  index,
  note,
  ended = false,
  canRemove,
  busy,
  onRemove,
}: {
  story: BusinessStory;
  index: number;
  note: string;
  ended?: boolean;
  canRemove: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <figure
      className={`sto-tile${ended ? ' is-ended' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      <img src={story.imageUrl} alt="" />
      <span className="sto-tile-time">
        <Icon name={ended ? 'clock' : 'timer'} size={12} /> {note}
      </span>
      {canRemove && (
        <button
          type="button"
          className="sto-tile-remove"
          disabled={busy}
          onClick={onRemove}
          aria-label={t`Take this story down`}
        >
          <Icon name="trash" size={14} />
        </button>
      )}
      <figcaption>
        {story.caption && <p>{story.caption}</p>}
        <span className="sto-tile-facts">
          <span>
            <Icon name="eye" size={13} /> {story.views} {story.views === 1 ? t`view` : t`views`}
          </span>
          {story.location && (
            <span>
              <Icon name="pin" size={13} /> {story.location.name}
            </span>
          )}
        </span>
        {story.removedReason && <span className="sto-tile-removed"><Trans>Taken down: {story.removedReason}</Trans></span>}
      </figcaption>
    </figure>
  );
}
