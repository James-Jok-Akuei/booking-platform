import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAnalytics, getProfile, listLocations } from '../api/business';
import { useMoney } from '../money';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;

/** Last N days, as the ISO strings the endpoint takes. */
const since = (days: number) => ({
  from: new Date(Date.now() - days * 86_400_000).toISOString(),
  to: new Date().toISOString(),
});

/**
 * How the business is doing.
 *
 * Every figure here is the server's, including the currency — the endpoint used
 * to report a hardcoded 'USD' while the amounts were RWF (§67.4, fixed in §96),
 * which is exactly the mistake a screen dividing by 100 would make.
 *
 * Partial totals say so. `complete: false` means some appointments could not be
 * accounted for, and a number that quietly omits rows is the one a business
 * acts on and then stops trusting.
 */
export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [locationId, setLocationId] = useState('');
  const money = useMoney();

  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  const businessId = profile.data?.id;
  const stats = useQuery({
    queryKey: ['analytics', businessId, days, locationId],
    queryFn: () =>
      getAnalytics(businessId!, {
        ...since(days),
        ...(locationId ? { locationId } : {}),
      }),
    enabled: Boolean(businessId),
  });

  const data = stats.data;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>How it is going</h1>
          <p className="muted">Your bookings, your money and your ratings.</p>
        </div>
        <div className="filters">
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          {(locations.data?.length ?? 0) > 1 && (
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">All branches</option>
              {locations.data?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {stats.isLoading && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="stat-grid">
            <Stat label="Bookings" value={String(data.appointments.total)} />
            <Stat
              label="Turned up"
              value={`${data.appointments.completionRate}%`}
              hint={`${data.appointments.byStatus.COMPLETED ?? 0} completed`}
            />
            <Stat
              label="Did not turn up"
              value={`${data.appointments.noShowRate}%`}
              hint={`${data.appointments.byStatus.NO_SHOW ?? 0} no-shows`}
            />
            <Stat
              label="Cancelled"
              value={`${data.appointments.cancellationRate}%`}
              hint={`${data.appointments.byStatus.CANCELLED ?? 0} cancelled`}
            />
          </div>

          <div className="panel">
            <h2>Money</h2>
            <div className="stat-grid">
              <Stat
                label="Deposits taken"
                value={money.format(
                  data.money.collectedThroughPlatform.depositsMinor,
                  data.money.currency,
                )}
                hint={`across ${data.money.collectedThroughPlatform.appointmentCount} bookings`}
              />
              <Stat
                label="Your share of them"
                value={money.format(
                  data.money.collectedThroughPlatform.businessShareOfDepositsMinor,
                  data.money.currency,
                )}
              />
              <Stat
                label="Platform fees"
                value={money.format(data.money.platformFeesPaidMinor, data.money.currency)}
              />
              <Stat
                label="Owed by customers"
                value={money.format(
                  data.money.balanceOwedToBusiness.amountMinor,
                  data.money.currency,
                )}
                hint="paid to you directly, not through us"
              />
            </div>

            {/* Surfaced, not hidden: a partial total that does not announce
                itself is the number a business acts on and then stops trusting. */}
            {!data.money.collectedThroughPlatform.complete && (
              <p className="notice small">
                {data.money.collectedThroughPlatform.note}
              </p>
            )}
            {!data.money.balanceOwedToBusiness.complete && (
              <p className="notice small">{data.money.balanceOwedToBusiness.note}</p>
            )}
          </div>

          <div className="panel">
            <h2>Reviews and busiest times</h2>
            <div className="stat-grid">
              <Stat
                label="Rating"
                value={
                  data.reviews.averageRating === null
                    ? '—'
                    : data.reviews.averageRating.toFixed(1)
                }
                hint={`from ${data.reviews.count} reviews`}
              />
              <Stat
                label="Busiest day"
                value={
                  data.busiest.dayOfWeek ? DAYS[data.busiest.dayOfWeek.day] : '—'
                }
                hint={
                  data.busiest.dayOfWeek
                    ? `${data.busiest.dayOfWeek.appointments} bookings`
                    : undefined
                }
              />
              <Stat
                label="Busiest hour"
                value={data.busiest.hour ? hourLabel(data.busiest.hour.hour) : '—'}
                hint={
                  data.busiest.hour
                    ? `${data.busiest.hour.appointments} bookings · ${data.busiest.timeZone}`
                    : undefined
                }
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
