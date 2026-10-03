import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  approveBusiness,
  getBusiness,
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
  const [openId, setOpenId] = useState<string | null>(null);
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
                onOpen={() => setOpenId(business.id)}
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

      {openId && <BusinessDrawer id={openId} onClose={() => setOpenId(null)} />}
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
  onOpen,
}: {
  business: AdminBusiness;
  busy: boolean;
  onApprove: () => void;
  onReinstate: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onOpen: () => void;
}) {
  // A business with no name cannot be approved — the backend refuses, because
  // an approved blank goes straight into search results (§53). Said here so the
  // admin sees why the button is off, rather than clicking into an error.
  const nameless = !business.name || business.name.trim() === '';

  return (
    <tr>
      <td>
        {/* The name opens the detail. Approving makes a business visible to every
            customer, and the row alone does not say what is being approved. */}
        <button type="button" className="link-strong" onClick={onOpen}>
          {business.name ?? <em className="muted">No name yet</em>}
        </button>
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

/**
 * Everything an approval decision rests on (§117.2).
 *
 * The list says a name and a status. This says where they work from, what they
 * sell and for how much at each branch, and who can act for them — which is what
 * `GET /admin/businesses/:id` has always returned and nothing ever showed.
 *
 * Read-only on purpose. The actions stay on the row where they already are:
 * duplicating approve and reject in here would mean two places to keep in step,
 * and the drawer's job is to answer "what am I about to let in", not to be a
 * second control panel.
 */
function BusinessDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const money = useMoney();
  const business = useQuery({ queryKey: ['business', id], queryFn: () => getBusiness(id) });
  const b = business.data;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{b?.name ?? 'Business'}</h2>
            <p className="muted small">
              {b?.category?.name ?? 'No category'}
              {b?.subcategory ? ` · ${b.subcategory.name}` : ''}
              {b ? ` · applied ${formatDate(b.createdAt)}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close this panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {business.isLoading && <p className="muted">Loading…</p>}
        {business.error && (
          <p className="error" role="alert">
            {business.error instanceof ApiError
              ? business.error.message
              : 'Could not load this business.'}
          </p>
        )}

        {b && (
          <>
            {b.description ? (
              <p>{b.description}</p>
            ) : (
              <p className="muted">
                No description. Customers see this on the shop page, so an empty one
                is worth asking about before approving.
              </p>
            )}

            <section className="panel">
              <h2>Branches ({b.locations.length})</h2>
              {b.locations.length === 0 ? (
                <p className="muted">
                  None. Nothing is bookable until they add one, so approving this
                  puts an empty shop in front of customers.
                </p>
              ) : (
                <ul className="plain">
                  {b.locations.map((location) => (
                    <li key={location.id}>
                      <strong>{location.name}</strong>
                      <div className="muted small">{location.address}</div>
                      <div className="muted small">
                        {location.capacity} at a time
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Services ({b.services.length})</h2>
              {b.services.length === 0 ? (
                <p className="muted">
                  None yet. There is nothing for a customer to book.
                </p>
              ) : (
                <ul className="plain">
                  {b.services.map((service) => (
                    <li key={service.id}>
                      <strong>{service.name}</strong>
                      {!service.isActive && <span className="pill">Paused</span>}
                      <div className="muted small">
                        {service.durationMinutes} minutes · {service.depositPercentage}%
                        deposit
                      </div>
                      {/* Per branch, because §72 made price a property of where
                          the service is offered rather than of the service. */}
                      {service.locations.length === 0 ? (
                        <div className="muted small">Not offered at any branch.</div>
                      ) : (
                        <div className="muted small">
                          {service.locations
                            .map(
                              (at) =>
                                `${at.location.name}: ${money.format(at.priceMinor)}`,
                            )
                            .join(' · ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>People ({b.members.length})</h2>
              <ul className="plain">
                {b.members.map((member) => (
                  <li key={member.id}>
                    <strong>{member.user.email}</strong>
                    <span className="pill">{member.role}</span>
                  </li>
                ))}
              </ul>
            </section>

            {b.statusReason && (
              <section className="panel">
                <h2>Why it is {b.status.toLowerCase()}</h2>
                <p>{b.statusReason}</p>
                <p className="muted small">{formatDate(b.statusChangedAt)}</p>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
