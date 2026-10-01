import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listLocationReviews,
  listLocations,
  respondToReview,
  updateReviewResponse,
  REVIEW_EDIT_WINDOW_DAYS,
  type Review,
} from '../api/business';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

/** The reply is editable for a week after posting; the server enforces it. */
const withinEditWindow = (responseAt: string) =>
  (Date.now() - new Date(responseAt).getTime()) / 86_400_000 < REVIEW_EDIT_WINDOW_DAYS;

/**
 * What customers said, and the one reply each gets.
 *
 * Replying is day-to-day work rather than configuration, so any active member
 * can do it — the server puts it with the STAFF-permitted actions, not the
 * owner-only ones, and this screen follows that.
 *
 * Hidden reviews are absent. The server excludes them for everyone including
 * the business, so this page shows exactly what a customer sees.
 */
export function ReviewsPage() {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [selected, setSelected] = useState<string | null>(null);

  const branches = locations.data ?? [];
  const locationId = selected ?? branches[0]?.id ?? null;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Reviews</h1>
          <p className="muted">
            What customers said, and your reply. Everyone can see both.
          </p>
        </div>
        {branches.length > 1 && (
          <label className="inline small">
            Branch
            <select
              value={locationId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {locations.isLoading && <p className="muted">Loading…</p>}
      {branches.length === 0 && !locations.isLoading && (
        <p className="muted empty">Add a branch first, under Branches &amp; hours.</p>
      )}

      {locationId && <BranchReviews locationId={locationId} />}
    </section>
  );
}

function BranchReviews({ locationId }: { locationId: string }) {
  const reviews = useQuery({
    queryKey: ['reviews', locationId],
    queryFn: () => listLocationReviews(locationId),
  });

  if (reviews.isLoading) return <p className="muted">Loading…</p>;
  if (!reviews.data) return null;

  const { ratingAvg, ratingCount, reviews: rows } = reviews.data;
  const unanswered = rows.filter((review) => !review.responseText).length;

  return (
    <>
      <div className="held">
        <div className="held-figures">
          <div className="held-figure">
            <span className="muted small">Rating</span>
            <strong>{ratingAvg === null ? 'No rating yet' : ratingAvg.toFixed(1)}</strong>
            <span className="muted small">
              {ratingCount === 1 ? 'from 1 review' : `from ${ratingCount} reviews`}
            </span>
          </div>
          {unanswered > 0 && (
            <div className="held-figure">
              <span className="muted small">Waiting for a reply</span>
              <strong className="warn">{unanswered}</strong>
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 && (
        <p className="muted empty">No reviews for this branch yet.</p>
      )}

      <ul className="reviews">
        {rows.map((review) => (
          <ReviewRow key={review.id} review={review} locationId={locationId} />
        ))}
      </ul>
    </>
  );
}

function ReviewRow({ review, locationId }: { review: Review; locationId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.responseText ?? '');

  const hasReply = Boolean(review.responseText);
  const editable = review.responseAt ? withinEditWindow(review.responseAt) : false;

  const save = useMutation({
    mutationFn: () =>
      hasReply
        ? updateReviewResponse(review.id, text.trim())
        : respondToReview(review.id, text.trim()),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['reviews', locationId] });
    },
  });

  return (
    <li className="review">
      <div className="review-head">
        <span className="rating" title={`${review.rating} out of 5`}>
          {stars(review.rating)}
        </span>
        <strong>{review.displayName}</strong>
        <span className="muted small">
          {when(review.createdAt)}
          {review.editedAt && ' · edited'}
        </span>
      </div>

      {review.comment ? (
        <p className="review-text">{review.comment}</p>
      ) : (
        <p className="muted small">They left a rating but no words.</p>
      )}

      {hasReply && !editing && (
        <div className="reply-shown">
          <div className="muted small">
            Your reply · {when(review.responseAt!)}
            {review.responseEditedAt && ' · edited'}
          </div>
          <p>{review.responseText}</p>
          {editable ? (
            <button type="button" className="link" onClick={() => setEditing(true)}>
              Edit reply
            </button>
          ) : (
            // Saying why beats a button that earns a 400.
            <span className="muted small">
              Replies can only be changed within {REVIEW_EDIT_WINDOW_DAYS} days of
              posting.
            </span>
          )}
        </div>
      )}

      {(!hasReply || editing) && (
        <form
          className="reply"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              review.rating <= 2
                ? 'A calm, specific reply does more for the next reader than for this one.'
                : 'Thank them, briefly.'
            }
          />
          {save.error && (
            <p className="error small" role="alert">
              {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
            </p>
          )}
          <div className="row-end">
            {editing && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEditing(false);
                  setText(review.responseText ?? '');
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="primary"
              disabled={save.isPending || text.trim() === ''}
            >
              {save.isPending ? 'Saving…' : hasReply ? 'Save reply' : 'Reply'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
