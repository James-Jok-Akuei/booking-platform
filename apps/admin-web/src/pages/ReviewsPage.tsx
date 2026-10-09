import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  hideReview,
  listReviewsForModeration,
  unhideReview,
  type ModeratedReview,
} from '../api/admin';
import { promptDialog } from '../ui/Dialog';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

const TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'VISIBLE', label: 'Showing' },
  { value: 'HIDDEN', label: 'Hidden' },
] as const;

/**
 * Review moderation.
 *
 * This is the only screen that can see a hidden review. Every other listing
 * excludes them in the query — which is what makes hiding real — so without
 * this one, hiding was a one-way door: nothing told an admin what they had
 * hidden, or let them find it again (§93).
 */
export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<'ALL' | 'VISIBLE' | 'HIDDEN'>('ALL');
  const [badOnly, setBadOnly] = useState(false);

  const reviews = useQuery({
    queryKey: ['moderated-reviews', visibility, badOnly],
    queryFn: () =>
      listReviewsForModeration({
        visibility,
        limit: 100,
        ...(badOnly ? { maxRating: 2 } : {}),
      }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['moderated-reviews'] });

  const hide = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      hideReview(input.id, input.reason),
    onSuccess: refresh,
  });

  const unhide = useMutation({ mutationFn: unhideReview, onSuccess: refresh });

  const onHide = async (review: ModeratedReview) => {
    const reason = await promptDialog({
      title: `Hide this ${review.rating}-star review?`,
      body: (
        <p>
          Of <strong>{review.businessName ?? 'this business'}</strong>. It stops showing to customers and stops
          counting towards the star rating. The review itself is kept — it is usually the evidence in whatever
          dispute led here.
        </p>
      ),
      label: 'Why are you hiding it?',
      placeholder: 'For example: insults the staff by name.',
      note: 'Recorded against your name.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'warn',
      icon: 'eye',
      confirmLabel: 'Hide the review',
      cancelLabel: 'Keep it showing',
    });
    if (reason === null) return;
    hide.mutate({ id: review.id, reason: reason.trim() });
  };

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Reviews</h1>
          <p className="muted">
            What customers wrote, and what has been taken down.
          </p>
        </div>
        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={tab.value === visibility ? 'tab active' : 'tab'}
              onClick={() => setVisibility(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="toolbar">
        <label className="inline small">
          <input
            type="checkbox"
            checked={badOnly}
            onChange={(event) => setBadOnly(event.target.checked)}
          />
          Only 1 and 2 star — the ones that get disputed
        </label>
        {reviews.data && (
          <span className="muted small">
            {reviews.data.total} shown · {reviews.data.hiddenCount} hidden across the
            platform
          </span>
        )}
      </div>

      {(hide.error || unhide.error) && (
        <p className="error" role="alert">
          {(hide.error ?? unhide.error) instanceof ApiError
            ? (hide.error ?? unhide.error)!.message
            : 'That did not work.'}
        </p>
      )}

      {reviews.isLoading && <p className="muted">Loading…</p>}
      {reviews.data?.reviews.length === 0 && (
        <p className="muted empty">Nothing here.</p>
      )}

      <ul className="reviews">
        {reviews.data?.reviews.map((review) => (
          <li key={review.id} className={review.hiddenAt ? 'review hidden' : 'review'}>
            <div className="review-head">
              <span className="rating">{stars(review.rating)}</span>
              <strong>{review.businessName ?? 'Unnamed business'}</strong>
              <span className="muted small">
                {review.locationName} · {formatDate(review.createdAt)}
                {review.editedAt && ' · edited'}
              </span>
              {review.hiddenAt && <span className="pill closed">Hidden</span>}
            </div>

            <div className="muted small">
              {/* Identity, which only an admin and the business receive. A
                  moderation decision cannot be made against "Anonymous". */}
              Shown as {review.displayName} · {review.customerEmail}
            </div>

            {review.comment ? (
              <p className="review-text">{review.comment}</p>
            ) : (
              <p className="muted small">A rating with no words.</p>
            )}

            {review.responseText && (
              <div className="reply-shown">
                <div className="muted small">
                  The business replied · {formatDate(review.responseAt)}
                </div>
                <p>{review.responseText}</p>
              </div>
            )}

            {review.hiddenAt && (
              <p className="notice">
                <strong>Hidden</strong> {formatDate(review.hiddenAt)}
                {review.hiddenByEmail && <> by {review.hiddenByEmail}</>} ·{' '}
                {review.hiddenReason}
              </p>
            )}

            <div className="row-end">
              {review.hiddenAt ? (
                <button
                  type="button"
                  disabled={unhide.isPending}
                  onClick={() => unhide.mutate(review.id)}
                >
                  {unhide.isPending ? 'Restoring…' : 'Show it again'}
                </button>
              ) : (
                <button type="button" disabled={hide.isPending} onClick={() => onHide(review)}>
                  {hide.isPending ? 'Hiding…' : 'Hide from customers'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
