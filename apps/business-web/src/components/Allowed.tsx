import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccess, type Access } from '../access';
import { Icon, type IconName } from '../ui/Icon';

type Need = 'money' | 'insights' | 'people';

const WORDS: Record<Need, { icon: IconName; title: string; body: string }> = {
  money: {
    icon: 'wallet',
    title: 'The money is for the owner',
    body: 'The balance and payouts are seen by the owner, and by managers who look after every branch. Ask the owner if you need to know something.',
  },
  insights: {
    icon: 'chart',
    title: 'This is for the owner and managers',
    body: 'How the business is going — bookings, takings and ratings over time — is seen by the owner and by managers.',
  },
  people: {
    icon: 'users',
    title: 'Only the owner adds people',
    body: 'Ask the owner to invite someone, or to change who works where.',
  },
};

/**
 * A page only some people may use (§277). Opened by its address by anyone
 * else, it says so in a sentence instead of showing a page full of refusals.
 * While we are still finding out who this is, the page shows — the server
 * still decides every request.
 */
export function Allowed({ need, children }: { need: Exclude<Need, 'people'>; children: ReactNode }) {
  const access = useAccess();
  if (!access.ready || access[need as keyof Access]) return <>{children}</>;
  return <NotForYou need={need} />;
}

export function NotForYou({ need }: { need: Need }) {
  const words = WORDS[need];
  return (
    <section className="nfy" role="status">
      <span className="nfy-icon">
        <Icon name={words.icon} size={26} />
        <i>
          <Icon name="lock" size={13} stroke={2.4} />
        </i>
      </span>
      <h1>{words.title}</h1>
      <p>{words.body}</p>
      <Link to="/" className="nfy-go">
        Back to your day <Icon name="arrowRight" size={16} />
      </Link>
    </section>
  );
}
