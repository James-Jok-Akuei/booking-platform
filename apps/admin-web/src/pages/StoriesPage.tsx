import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { keepStory, listAdminStories, removeStory, type AdminStory, type StoryView } from '../api/admin';
import { ago } from '../lib/time';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ShopMark } from '../ui/ShopMark';
import './stories.css';
import { EmptyState } from '../ui/EmptyState';

const VIEWS: Array<{ value: StoryView; label: string }> = [
  { value: 'reported', label: 'Reported' },
  { value: 'live', label: 'Up now' },
];

/** "13h 20m left", "45m left", "Ended". */
function left(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * Shops' stories, from the moderator's side (§285).
 *
 * A story is up the moment a shop posts it — nobody approves it first — so
 * this is where one that should not be up comes down. Reported ones first,
 * the most reported at the top, each with the reasons customers gave; every
 * story up right now beside them. Taking one down needs a reason, which the
 * shop is sent. One that is fine is kept up, and its reports cleared.
 */
export function StoriesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view: StoryView = params.get('view') === 'live' ? 'live' : 'reported';
  const [looking, setLooking] = useState<AdminStory | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const list = useQuery({
    queryKey: ['admin-stories', view],
    queryFn: () => listAdminStories(view),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-stories'] });
    void queryClient.invalidateQueries({ queryKey: ['shell-count', 'stories'] });
  };

  const remove = useMutation({
    mutationFn: (input: { id: string; reason: string }) => removeStory(input.id, input.reason),
    onSuccess: refresh,
  });
  const keep = useMutation({ mutationFn: keepStory, onSuccess: refresh });

  const onRemove = async (story: AdminStory) => {
    const reason = await promptDialog({
      title: 'Take this story down?',
      body: (
        <p>
          From <strong>{story.business.name}</strong>. Customers stop seeing it at once. The shop is told, with your
          reason, and can ask support about it.
        </p>
      ),
      label: 'Why are you taking it down?',
      placeholder: 'For example: the photo is not of this shop.',
      note: 'The shop reads these words. Kept with the story, against your name.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'danger',
      icon: 'trash',
      confirmLabel: 'Take it down',
      cancelLabel: 'Leave it up',
    });
    if (reason !== null) {
      setLooking(null);
      remove.mutate({ id: story.id, reason: reason.trim() });
    }
  };

  const onKeep = async (story: AdminStory) => {
    const ok = await confirmDialog({
      title: 'Keep this story up?',
      body: (
        <p>
          Its {story.reportCount === 1 ? 'report is' : `${story.reportCount} reports are`} cleared and it leaves this
          list. If someone reports it again, it comes back.
        </p>
      ),
      tone: 'ok',
      icon: 'checkCircle',
      confirmLabel: 'Keep it up',
      cancelLabel: 'Not yet',
    });
    if (ok) {
      setLooking(null);
      keep.mutate(story.id);
    }
  };

  const data = list.data;
  const stories = data?.stories ?? [];
  const error = remove.error ?? keep.error;
  const busy = remove.isPending || keep.isPending;

  return (
    <section className="ast">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Stories</h1>
            <p className="muted">
              A photo a shop puts up for 24 hours, at the top of the customer app. It is up the moment it is posted —
              this is where one comes down.
            </p>
          </div>
        </header>
      </div>

      <div className="ast-card">
        <div className="ast-tabs" role="tablist">
          {VIEWS.map((v) => {
            const count = v.value === 'reported' ? data?.reported : data?.live;
            return (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                className={`ast-tab${view === v.value ? ' is-on' : ''}${v.value === 'reported' && count ? ' tone-warn' : ''}`}
                onClick={() => setParams(v.value === 'reported' ? {} : { view: v.value }, { replace: true })}
              >
                {v.label}
                {count !== undefined && <span className="ast-tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className={`ast-board${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
          {error && (
            <p className="error ast-error" role="alert">
              <Icon name="alert" size={15} />
              {error instanceof ApiError ? error.message : 'That did not work.'}
            </p>
          )}

          {list.isLoading && (
            <div className="ast-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="ast-skel" />
              ))}
            </div>
          )}

          {data && stories.length === 0 && (
            <EmptyState
              size="card"
              className="is-list"
              art={view === 'reported' ? 'clear' : 'photo'}
              title={view === 'reported' ? 'Nothing reported' : 'No stories up right now'}
              text={
                view === 'reported'
                  ? 'When a customer reports a story, it waits here — the most reported first.'
                  : 'Shops post one from their Stories page. Each stays up for 24 hours.'
              }
            />
          )}

          <ul className="ast-grid">
            {stories.map((story, i) => (
              <StoryCard
                key={story.id}
                story={story}
                index={i}
                now={now}
                busy={busy}
                onLook={() => setLooking(story)}
                onRemove={() => void onRemove(story)}
                onKeep={() => void onKeep(story)}
              />
            ))}
          </ul>
        </div>
      </div>

      {looking && (
        <div className="ast-look" role="dialog" aria-label="The story, full size" onClick={() => setLooking(null)}>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={looking.imageUrl} alt={looking.caption ?? 'The story'} />
            <figcaption>
              <span className="ast-look-shop">
                <ShopMark name={looking.business.name} logoUrl={looking.business.logoUrl} size={30} />
                <strong>{looking.business.name}</strong>
              </span>
              {looking.caption && <p>{looking.caption}</p>}
              <span className="ast-look-actions">
                <button type="button" className="danger" onClick={() => void onRemove(looking)} disabled={busy}>
                  <Icon name="trash" size={15} /> Take it down
                </button>
                <button type="button" onClick={() => setLooking(null)}>
                  Close
                </button>
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

function StoryCard({
  story,
  index,
  now,
  busy,
  onLook,
  onRemove,
  onKeep,
}: {
  story: AdminStory;
  index: number;
  now: number;
  busy: boolean;
  onLook: () => void;
  onRemove: () => void;
  onKeep: () => void;
}) {
  const time = left(story.expiresAt, now);
  const more = story.reportCount - story.reports.length;

  return (
    <li
      className={`ast-item${story.reportCount > 0 ? ' is-reported' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <button type="button" className="ast-photo" onClick={onLook} aria-label="See the story full size">
        <img src={story.imageUrl} alt="" loading="lazy" />
        <span className="ast-time">
          <Icon name="timer" size={12} /> {time}
        </span>
        <span className="ast-zoom" aria-hidden="true">
          <Icon name="eye" size={16} />
        </span>
      </button>

      <div className="ast-body">
        <header className="ast-shop">
          <ShopMark name={story.business.name} logoUrl={story.business.logoUrl} size={36} />
          <span>
            <strong>{story.business.name}</strong>
            <small>
              {story.location?.name ?? 'The whole shop'} · {ago(story.createdAt, now)}
            </small>
          </span>
        </header>

        {story.caption ? (
          <p className="ast-caption">“{story.caption}”</p>
        ) : (
          <p className="ast-caption is-none">No words — the photo only.</p>
        )}

        <div className="ast-facts">
          <span>
            <Icon name="eye" size={13} /> {story.views} {story.views === 1 ? 'view' : 'views'}
          </span>
          {story.reportCount > 0 && (
            <span className="is-warn">
              <Icon name="alert" size={13} /> {story.reportCount} {story.reportCount === 1 ? 'report' : 'reports'}
            </span>
          )}
        </div>

        {story.reports.length > 0 && (
          <ul className="ast-reasons" aria-label="What customers said">
            {story.reports.map((report, i) => (
              <li key={i}>
                <span>{report.reason}</span>
                <time dateTime={report.createdAt}>{ago(report.createdAt, now)}</time>
              </li>
            ))}
            {more > 0 && <li className="ast-reasons-more">and {more} more</li>}
          </ul>
        )}

        <footer className="ast-actions">
          <button type="button" className="ast-remove" onClick={onRemove} disabled={busy}>
            <Icon name="trash" size={15} /> Take it down
          </button>
          {story.reportCount > 0 && (
            <button type="button" className="ast-keep" onClick={onKeep} disabled={busy}>
              <Icon name="check" size={15} /> Keep it up
            </button>
          )}
        </footer>
      </div>
    </li>
  );
}
