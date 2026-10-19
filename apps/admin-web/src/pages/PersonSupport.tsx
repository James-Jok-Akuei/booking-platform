import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupportPerson, supportCloseAccount, supportSignOutEverywhere, supportStopMarketing } from '../api/admin';
import { SupportActButton, SupportHistory, SupportPanel, useOpenRequests } from '../components/SupportPanel';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

/** What support can do for a person (§297). */
export type PersonAct = 'signOut' | 'stopMarketing' | 'close';

/**
 * "Help with this account" (§297): a lost phone, marketing they cannot find
 * the switch for, an account they want gone and cannot reach — each the same
 * change they could make themselves, with a reason and a line in the log.
 */
export function PersonSupportSection({
  userId,
  onAct,
  onClose,
}: {
  userId: string;
  onAct: (act: PersonAct) => void;
  onClose: () => void;
}) {
  const person = useQuery({ queryKey: ['support-person', userId], queryFn: () => getSupportPerson(userId) });
  const p = person.data;
  const marketingOn = p ? p.marketing.newsChoicesOn > 0 || p.marketing.weeklyOffersEmail || p.marketing.shopsSendingOffers > 0 : false;

  return (
    <section className="up-section">
      <h4>
        <Icon name="help" size={15} /> Help with this account
      </h4>
      {!p ? (
        <div className="skeleton sa-skel" />
      ) : (
        <>
          <dl className="sa-facts">
            <div>
              {/* Each sign-in counts, a phone signed in twice too — so not "phones". */}
              <dt>Sign-ins still open</dt>
              <dd>{p.signedInSessions === 0 ? 'None' : p.signedInSessions}</dd>
            </div>
            <div>
              <dt>Marketing</dt>
              <dd>
                {marketingOn
                  ? [
                      p.marketing.newsChoicesOn > 0 && 'news',
                      p.marketing.weeklyOffersEmail && 'weekly email',
                      p.marketing.shopsSendingOffers > 0 &&
                        `offers from ${p.marketing.shopsSendingOffers} shop${p.marketing.shopsSendingOffers === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(', ')
                  : 'Off'}
              </dd>
            </div>
          </dl>
          <div className="sa-acts">
            <SupportActButton
              icon="logout"
              label="Sign them out everywhere"
              note="A lost phone, or someone else got in"
              onClick={() => onAct('signOut')}
            />
            {marketingOn && (
              <SupportActButton icon="bell" label="Stop the marketing" note="News and offers; bookings still come" onClick={() => onAct('stopMarketing')} />
            )}
            <SupportActButton icon="lock" tone="danger" label="Close the account" note="They asked, and cannot reach the app" onClick={() => onAct('close')} />
          </div>
        </>
      )}
      <div style={{ marginTop: 12 }}>
        <SupportHistory filter={{ userId }} onOpen={onClose} />
      </div>
    </section>
  );
}

export function PersonActPanel({
  user,
  act,
  onBack,
  onClose,
}: {
  user: { id: string; email: string; displayName: string | null };
  act: PersonAct;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const tickets = useOpenRequests({ reporterId: user.id });
  const face = <Avatar label={user.displayName || user.email} size={30} />;
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['support-person', user.id] });
    void queryClient.invalidateQueries({ queryKey: ['support-history'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    onBack();
  };
  const common = { eyebrow: user.displayName ?? user.email, tickets, onBack, onClose, onDone: done };

  switch (act) {
    case 'signOut':
      return (
        <SupportPanel
          {...common}
          title="Sign them out everywhere"
          consequences={[
            { mark: face, text: <><strong>{user.email}</strong> is signed out on every phone and computer, within a few minutes.</> },
            { mark: 'bell', text: 'Notifications to those phones stop too — a lost phone stops showing their bookings.' },
            { mark: 'mail', text: 'They sign in again with a code sent to their email, and are told why.' },
          ]}
          placeholder="Their phone was stolen yesterday; they wrote from a friend’s phone."
          confirmLabel="Sign them out"
          run={(body) => supportSignOutEverywhere(user.id, body)}
        />
      );
    case 'stopMarketing':
      return (
        <SupportPanel
          {...common}
          title="Stop the marketing"
          consequences={[
            { mark: 'bell', text: 'News, offers from shops they follow, and the weekly email all stop.' },
            { mark: 'calendar', text: 'Their bookings, messages and account notices carry on.' },
            { mark: 'shield', text: 'Each “no” is kept like one they gave themselves. They can turn any back on.' },
          ]}
          placeholder="They asked us to stop the offers and could not find the switch."
          confirmLabel="Stop it"
          run={(body) => supportStopMarketing(user.id, body)}
        />
      );
    case 'close':
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title="Close the account"
          warning={
            <>
              <strong>This cannot be undone.</strong> You will be asked for a code first.
            </>
          }
          consequences={[
            { mark: face, text: <><strong>{user.email}</strong> can no longer sign in. Their name comes off their reviews.</> },
            { mark: 'calendar', text: 'Bookings and reviews stay with the shops — they are financial records. Bookings still to come must be cancelled first.' },
            { mark: 'mail', text: 'They are emailed first, since the address goes when it closes. They can make a new account later.' },
          ]}
          placeholder="They asked us to close it; they lost access to the phone with the app."
          minReason={10}
          confirmLabel="Close it"
          busyLabel="Closing…"
          run={(body) => supportCloseAccount(user.id, body)}
        />
      );
  }
}
