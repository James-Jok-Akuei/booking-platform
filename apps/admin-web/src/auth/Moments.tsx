import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { NetworkMark } from '../ui/NetworkMark';

type Moment = { mark: ReactNode; title: string; text: string };

const mark = (icon: IconName, tone: string) => (
  <span className={`au-moment-mark tone-${tone}`}>
    <Icon name={icon} size={19} />
  </span>
);

/** The platform's day, as it reaches the people who look after it — the console's own queues (§243). */
const MOMENTS: Moment[] = [
  { mark: mark('store', 'coral'), title: 'A shop to approve', text: 'Kacyiru Studio sent its details' },
  {
    mark: <NetworkMark network="MTN_MOMO" size={40} className="au-moment-momo" />,
    title: 'A payout number to check',
    text: '+250 788 … · MTN MoMo',
  },
  { mark: mark('help', 'night'), title: 'A new ticket', text: '“Problem with my booking”' },
  { mark: mark('send', 'green'), title: 'Payouts ready to send', text: '3 shops · RWF 28,400' },
  { mark: mark('star', 'gold'), title: 'A review to look at', text: '★☆☆☆☆ · “Not what I expected”' },
];

/**
 * The console's half of the sign-in wall (§254), as the business app's is the
 * seller's (§238): over the shops' photos, what waits for an administrator
 * arriving one notice at a time — a shop to approve, a number to check, a
 * ticket, payouts to send, a review. On a wide screen only, and still when
 * the browser asks for less motion.
 */
export function Moments() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % MOMENTS.length), 3600);
    return () => clearInterval(timer);
  }, []);

  const moment = MOMENTS[index];
  return (
    <div className="au-moments" aria-hidden="true">
      <div className="au-moment" key={index}>
        {moment.mark}
        <span className="au-moment-text">
          <strong>{moment.title}</strong>
          <span>{moment.text}</span>
        </span>
        <em>now</em>
      </div>
    </div>
  );
}
