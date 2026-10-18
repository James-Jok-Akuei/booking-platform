import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { deleteStory, getProfile, listLocations, listMyStories, postStory, type BusinessStory } from '../api/business';
import { useAccess } from '../access';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ShopLogo } from '../ui/ShopLogo';
import './stories.css';

const CAPTION_MAX = 150;
/** Words to start from, for any kind of shop; a tap puts one in the box. */
const IDEAS = [
  'Free this afternoon — book now',
  'Something we did today',
  'New this week — book it in the app',
  'Open late tonight',
];
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** "13h 20m left", "45m left". */
function left(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
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
        title: 'Take this story down?',
        body: <p>Customers stop seeing it straight away. It cannot be brought back — you can post it again.</p>,
        tone: 'danger',
        icon: 'trash',
        confirmLabel: 'Take it down',
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
            <h1>Stories</h1>
            <p className="muted">
              A photo and a few words for today. Customers see it at the top of the app for 24 hours, with a Book button
              that brings them straight to you.
            </p>
          </div>
        </header>
      </div>

      {!shopLive && (
        <p className="sto-note">
          <Icon name="info" size={16} /> Customers see your stories once your shop is live. You can post them now — they
          show as soon as it is.
        </p>
      )}

      <div className="sto-layout">
        {access.runsBranches ? (
          <Composer
            postedToday={stories.data?.postedToday ?? 0}
            dailyLimit={stories.data?.dailyLimit ?? 10}
            shopName={p?.name ?? 'Your shop'}
            logoUrl={p?.logoUrl ?? null}
            branches={(locations.data ?? []).filter((l) => l.isActive && access.sees(l.id))}
            wholeShop={access.allBranches}
            onPosted={() => queryClient.invalidateQueries({ queryKey: ['stories'] })}
          />
        ) : (
          <aside className="sto-card sto-readonly">
            <Icon name="shield" size={18} />
            <p>The owner or a manager posts stories. You can see them here.</p>
          </aside>
        )}

        <div className="sto-lists">
          <article className="sto-card">
            <header className="sto-card-head">
              <h2>Live now</h2>
              <span>{live.length}</span>
            </header>
            {stories.isLoading && <div className="skeleton sto-skeleton" />}
            {stories.data && live.length === 0 && (
              <div className="sto-empty">
                <span className="sto-empty-ring">
                  <Icon name="stories" size={28} />
                </span>
                <strong>No story up right now</strong>
                <p>A shop with a story gets a coral ring in the app — the first thing customers tap.</p>
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
                <h2>Ended</h2>
                <span>{ended.length}</span>
              </header>
              <div className="sto-grid">
                {ended.map((story, i) => (
                  <StoryTile
                    key={story.id}
                    story={story}
                    index={i}
                    note={story.removedAt ? 'Taken down' : 'Ended'}
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
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
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

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    setDone(false);
    post.reset();
    setFile(picked);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/')));
  };

  const place = branchId ? branches.find((b) => b.id === branchId)?.name : null;

  return (
    <aside className="sto-composer">
      {/* What customers will see, as they will see it. */}
      <div
        className={`sto-phone${dragging ? ' is-dragging' : ''}${preview ? ' has-photo' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {preview ? (
          <>
            <img className="sto-phone-blur" src={preview} alt="" aria-hidden="true" />
            <img className="sto-phone-photo" src={preview} alt="Your story" />
          </>
        ) : (
          <label className="sto-pick" htmlFor="story-photo">
            <span className="sto-pick-icon">
              <Icon name="camera" size={26} />
            </span>
            <strong>Choose a photo</strong>
            <span>or drop one here</span>
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
              <small>{place ? `${place} · now` : 'now'}</small>
            </span>
          </div>
        </div>
        {(caption.trim() || preview) && (
          <div className="sto-phone-foot">
            {caption.trim() && <p>{caption.trim()}</p>}
            <span className="sto-book">Book at {place ?? shopName}</span>
          </div>
        )}
        {preview && (
          <label className="sto-change" htmlFor="story-photo">
            <Icon name="image" size={15} /> Change photo
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

      <div className="sto-form">
        <label className="sto-field">
          <span>
            A few words{' '}
            <em>
              {caption.length}/{CAPTION_MAX}
            </em>
          </span>
          <textarea
            rows={2}
            maxLength={CAPTION_MAX}
            value={caption}
            placeholder="Two slots free this afternoon — book now"
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>

        {(branches.length > 1 || (!wholeShop && branches.length > 0)) && (
          <div className="sto-field">
            <span>About</span>
            <div className="sto-where" role="radiogroup" aria-label="Which branch">
              {wholeShop && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={branchId === null}
                  className={branchId === null ? 'is-on' : ''}
                  onClick={() => setWhere(null)}
                >
                  <Icon name="store" size={14} /> The whole shop
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

        <div className="sto-meter" aria-label={`${postedToday} of ${dailyLimit} stories posted today`}>
          <span>
            {postedToday} of {dailyLimit} today
          </span>
          <i>
            <b style={{ width: `${Math.min(100, (postedToday / dailyLimit) * 100)}%` }} />
          </i>
        </div>

        {post.error && (
          <p className="sto-problem" role="alert">
            <Icon name="alert" size={15} />
            {post.error instanceof ApiError ? post.error.message : 'That did not post. Check your connection.'}
          </p>
        )}
        {done && (
          <p className="sto-done" role="status">
            <Icon name="checkCircle" size={16} /> Posted — live for 24 hours.
          </p>
        )}

        <button
          type="button"
          className="primary sto-post"
          disabled={!file || post.isPending || full}
          onClick={() => post.mutate()}
        >
          <Icon name="send" size={16} />
          {post.isPending ? 'Posting…' : full ? 'Ten posted today' : 'Post story'}
        </button>

        <div className="sto-ideas">
          <span>
            <Icon name="sparkles" size={14} /> Need words? Tap one
          </span>
          <div>
            {IDEAS.map((idea) => (
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
          aria-label="Take this story down"
        >
          <Icon name="trash" size={14} />
        </button>
      )}
      <figcaption>
        {story.caption && <p>{story.caption}</p>}
        <span className="sto-tile-facts">
          <span>
            <Icon name="eye" size={13} /> {story.views} {story.views === 1 ? 'view' : 'views'}
          </span>
          {story.location && (
            <span>
              <Icon name="pin" size={13} /> {story.location.name}
            </span>
          )}
        </span>
        {story.removedReason && <span className="sto-tile-removed">Taken down: {story.removedReason}</span>}
      </figcaption>
    </figure>
  );
}
