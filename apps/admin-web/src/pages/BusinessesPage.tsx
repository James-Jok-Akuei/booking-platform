import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  approveBusiness,
  listBusinesses,
  reinstateBusiness,
  rejectBusiness,
  suspendBusiness,
  type AdminBusiness,
  type BusinessStatus,
} from '../api/admin';

const STATUSES: Array<{ value: BusinessStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'Awaiting review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

/**
 * The approval queue.
 *
 * Defaults to PENDING because that is the only list with work in it — an admin
 * opening this app is almost always here to answer "who is waiting". The
 * backend already returns the queue oldest-first, so whoever has waited longest
 * is read first rather than last.
 */
export function BusinessesPage() {
  const [status, setStatus] = useState<BusinessStatus | 'ALL'>('PENDING');
  const queryClient = useQueryClient();

  const businesses = useQuery({
    queryKey: ['businesses', status],
    queryFn: () => listBusinesses(status === 'ALL' ? {} : { status }),
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: string; reason?: string }) => {
      switch (input.action) {
        case 'approve':
          return approveBusiness(input.id);
        case 'reinstate':
          return reinstateBusiness(input.id);
        case 'reject':
          return rejectBusiness(input.id, input.reason!);
        case 'suspend':
          return suspendBusiness(input.id, input.reason!);
        default:
          throw new Error(`Unknown action ${input.action}.`);
      }
    },
    // Refetch rather than patch the cache: a transition can change more than
    // the status (statusReason, statusChangedAt, who acted), and the server is
    // the only thing that knows what it actually wrote.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  /**
   * Rejection and suspension require a reason, and the backend enforces 3-500
   * characters. Asking here means the admin is not told off by a validation
   * error after the fact.
   */
  const withReason = (id: string, action: 'reject' | 'suspend') => {
    const verb = action === 'reject' ? 'Rejecting' : 'Suspending';
    const reason = window.prompt(
      `${verb} this business. The reason is sent to them, so write it for them to read:`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      window.alert('A reason of at least 3 characters is required.');
      return;
    }
    act.mutate({ id, action, reason: reason.trim() });
  };

  return (
    <section>
      <header className="page-head">
        <h1>Businesses</h1>
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

      {act.error && (
        <p className="error" role="alert">
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}

      {businesses.isLoading && <p className="muted">Loading…</p>}

      {businesses.error && (
        <p className="error" role="alert">
          {businesses.error instanceof ApiError
            ? businesses.error.message
            : 'Could not load businesses.'}
        </p>
      )}

      {businesses.data && businesses.data.businesses.length === 0 && (
        <p className="muted empty">Nothing here.</p>
      )}

      {businesses.data && businesses.data.businesses.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Category</th>
              <th>Applied</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {businesses.data.businesses.map((business) => (
              <Row
                key={business.id}
                business={business}
                busy={act.isPending && act.variables?.id === business.id}
                onApprove={() => act.mutate({ id: business.id, action: 'approve' })}
                onReinstate={() => act.mutate({ id: business.id, action: 'reinstate' })}
                onReject={() => withReason(business.id, 'reject')}
                onSuspend={() => withReason(business.id, 'suspend')}
              />
            ))}
          </tbody>
        </table>
      )}

      {businesses.data && (
        <p className="muted count">
          {businesses.data.businesses.length} of {businesses.data.total}
        </p>
      )}
    </section>
  );
}

function Row({
  business,
  busy,
  onApprove,
  onReinstate,
  onReject,
  onSuspend,
}: {
  business: AdminBusiness;
  busy: boolean;
  onApprove: () => void;
  onReinstate: () => void;
  onReject: () => void;
  onSuspend: () => void;
}) {
  // A business with no name cannot be approved — the backend refuses, because
  // an approved blank goes straight into search results (§53). Said here so the
  // admin sees why the button is off, rather than clicking into an error.
  const nameless = !business.name || business.name.trim() === '';

  return (
    <tr>
      <td>
        <strong>{business.name ?? <em className="muted">No name yet</em>}</strong>
        {business.phone && <div className="muted small">{business.phone}</div>}
        {business.statusReason && (
          <div className="muted small">Reason: {business.statusReason}</div>
        )}
      </td>
      <td>
        {business.category?.name ?? '—'}
        {business.subcategory && (
          <div className="muted small">{business.subcategory.name}</div>
        )}
      </td>
      <td>{formatDate(business.createdAt)}</td>
      <td>
        <span className={`pill ${business.status.toLowerCase()}`}>{business.status}</span>
        {business.statusChangedAt && (
          <div className="muted small">{formatDate(business.statusChangedAt)}</div>
        )}
      </td>
      <td className="actions">
        {business.status === 'PENDING' && (
          <>
            <button type="button" disabled={busy || nameless} onClick={onApprove}>
              Approve
            </button>
            <button type="button" className="danger" disabled={busy} onClick={onReject}>
              Reject
            </button>
            {nameless && <div className="muted small">Needs a name first</div>}
          </>
        )}
        {business.status === 'APPROVED' && (
          <button type="button" className="danger" disabled={busy} onClick={onSuspend}>
            Suspend
          </button>
        )}
        {business.status === 'SUSPENDED' && (
          <button type="button" disabled={busy || nameless} onClick={onReinstate}>
            Reinstate
          </button>
        )}
        {business.status === 'REJECTED' && <span className="muted small">Closed</span>}
      </td>
    </tr>
  );
}
