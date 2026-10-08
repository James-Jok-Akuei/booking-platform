import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { NetworkMark } from '../ui/NetworkMark';

type Moment = { mark: ReactNode; title: string; text: string };

const mark = (icon: IconName, tone: string) => (
  <span className={`au-moment-mark tone-${tone}`}>
    <Icon name={icon} size={19} />
  </span>
);

/** A shop's day, as it reaches the seller — what the app is for, said in its own notices. */
const MOMENTS: Moment[] = [
  { mark: mark('calendarCheck', 'coral'), title: 'New booking', text: 'Haircut · Saturday at 10:30' },
  {
    mark: <NetworkMark network="MTN_MOMO" size={40} className="au-moment-momo" />,
    title: 'Deposit paid',
    text: 'RWF 1,400 · MTN MoMo',
  },
  { mark: mark('ticket', 'night'), title: 'Checked in', text: 'Code 4 8 2 · 1 9 0 — right on time' },
  { mark: mark('star', 'gold'), title: 'New review ★★★★★', text: '“Quick, friendly, exactly what I asked for.”' },
  { mark: mark('wallet', 'green'), title: 'Ready to send', text: 'RWF 9,400 to your MoMo number' },
];

/**
 * The business half of the sign-in wall (§238): over the shops' photos, a
 * seller's day arriving as notices — a booking, its deposit, the check-in, a
 * review, the money to send — one after another, each settling on a soft
 * stack the way they do on a phone. The customer app's wall needs none: its
 * reader is booking, not running a shop.
 *
 * On a wide screen only, and still when the browser asks for less motion.
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
