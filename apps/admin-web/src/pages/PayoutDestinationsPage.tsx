import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listPayoutDestinations,
  rejectPayoutDestination,
  verifyPayoutDestination,
  type PayoutDestination,
  type PayoutDestinationStatus,
} from '../api/admin';
import { promptDialog } from '../ui/Dialog';

const STATUSES: Array<{ value: PayoutDestinationStatus | 'ALL'; label: string }> = [
  { value: 'UNVERIFIED', label: 'Awaiting check' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUPERSEDED', label: 'Superseded' },
  { value: 'ALL', label: 'All' },
];

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Where a business gets paid, and the check before money goes there.
 *
 * This queue is the reason payouts can run at all: an unverified destination
 * PAUSES that business's payouts rather than silently skipping them (§48.3), so
 * a business left sitting here is a business not being paid. It defaults to
 * "Awaiting check" for that reason, and the backend returns unverified first
 * and oldest-first within that.
 */
export function PayoutDestinationsPage() {
  const [status, setStatus] = useState<PayoutDestinationStatus | 'ALL'>('UNVERIFIED');
  const queryClient = useQueryClient();

  const destinations = useQuery({
    queryKey: ['payout-destinations', status],
    queryFn: () => listPayoutDestinations(status === 'ALL' ? {} : { status }),
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'verify' | 'reject'; text: string }) =>
      input.action === 'verify'
        ? verifyPayoutDestination(input.id, input.text)
        : rejectPayoutDestination(input.id, input.text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payout-destinations'] }),
  });

  const verify = async (destination: PayoutDestination) => {
    const note = await promptDialog({
      title: 'Verify this payout number?',
      body: (
        <p>
          <strong>{destination.msisdn}</strong> for{' '}
          <strong>{destination.businessProfile.name ?? 'this business'}</strong>. Once verified, the shop’s money is
          sent to this number — and money sent does not come back.
        </p>
      ),
      label: 'How did you confirm it is theirs?',
      placeholder: 'For example: called the owner on the shop’s number; the name on MoMo matches.',
      note: 'Recorded, and the only account of this decision once money has moved.',
      minLength: 3,
      minMessage: 'A note of at least 3 characters.',
      multiline: true,
      tone: 'ok',
      icon: 'shield',
      confirmLabel: 'Verify the number',
      cancelLabel: 'Not yet',
    });
    if (note === null) return;
    act.mutate({ id: destination.id, action: 'verify', text: note.trim() });
  };

  const reject = async (destination: PayoutDestination) => {
    const reason = await promptDialog({
      title: 'Reject this payout number?',
      body: (
        <p>
          The business is told the reason and asked for another number. Until one is verified, their payouts wait.
        </p>
      ),
      label: 'Reason — sent to them, so they know what to fix',
      placeholder: 'For example: the MoMo name does not match the business owner.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'danger',
      icon: 'xCircle',
      confirmLabel: 'Reject the number',
      cancelLabel: 'Not now',
    });
    if (reason === null) return;
    act.mutate({ id: destination.id, action: 'reject', text: reason.trim() });
  };

  return (
    <section>
      <header className="page-head">
        <h1>Payout destinations</h1>
        <div className="tabs">
          {STATUSES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === status ? 'tab active' : 'tab'}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {status === 'UNVERIFIED' && (
        <p className="notice">
          A business sitting here is <strong>not being paid</strong>. An unverified
          number pauses that business's payouts rather than skipping them quietly.
        </p>
      )}

      {act.error && (
        <p className="error" role="alert">
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}

      {destinations.isLoading && <p className="muted">Loading…</p>}

      {destinations.error && (
        <p className="error" role="alert">
          {destinations.error instanceof ApiError
            ? destinations.error.message
            : 'Could not load payout destinations.'}
        </p>
      )}

      {destinations.data && destinations.data.destinations.length === 0 && (
        <p className="muted empty">Nothing here.</p>
      )}

      {destinations.data && destinations.data.destinations.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Number</th>
              <th>Submitted</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {destinations.data.destinations.map((destination) => (
              <tr key={destination.id}>
                <td>
                  <strong>
                    {destination.businessProfile.name ?? (
                      <em className="muted">No name</em>
                    )}
                  </strong>
                  {destination.businessProfile.phone && (
                    <div className="muted small">
                      On file: {destination.businessProfile.phone}
                    </div>
                  )}
                </td>
                <td>
                  <code>{destination.msisdn}</code>
                  <div className="muted small">{destination.provider.replace('_', ' ')}</div>
                </td>
                <td className="small">{formatDate(destination.submittedAt)}</td>
                <td>
                  <span className={`pill ${destination.status.toLowerCase()}`}>
                    {destination.status}
                  </span>
                  {destination.verificationNote && (
                    <div className="muted small">
                      {destination.verificationMethod === 'ADMIN' ? 'By admin' : 'By OTP'}:{' '}
                      {destination.verificationNote}
                    </div>
                  )}
                  {destination.rejectionReason && (
                    <div className="muted small">Reason: {destination.rejectionReason}</div>
                  )}
                  {/* A superseded row exists for the history, so it has to say
                      what came next — otherwise the page asks the reader to
                      work it out from timestamps (§78). */}
                  {destination.replacedBy && (
                    <div className="muted small">
                      Replaced by <code>{destination.replacedBy.msisdn}</code> on{' '}
                      {formatDate(destination.replacedBy.submittedAt)}
                      {destination.replacedBy.status !== 'VERIFIED' &&
                        ` (${destination.replacedBy.status.toLowerCase()})`}
                    </div>
                  )}
                </td>
                <td className="actions">
                  {destination.status === 'UNVERIFIED' ? (
                    <>
                      <button
                        type="button"
                        disabled={act.isPending}
                        onClick={() => verify(destination)}
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={act.isPending}
                        onClick={() => reject(destination)}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="muted small">
                      {destination.status === 'SUPERSEDED'
                        ? 'Kept as history'
                        : formatDate(destination.verifiedAt)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {destinations.data && (
        <p className="muted count">
          {destinations.data.destinations.length} of {destinations.data.total}
        </p>
      )}
    </section>
  );
}
