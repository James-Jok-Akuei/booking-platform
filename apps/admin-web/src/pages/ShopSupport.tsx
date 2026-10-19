import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSupportShop,
  listAdminInvitations,
  supportPauseShop,
  supportRemoveMember,
  supportResendInvitation,
  supportRevokeInvitation,
  supportTransferOwnership,
  type SupportShop,
} from '../api/admin';
import { SupportActButton, SupportHistory, SupportPanel, useOpenRequests } from '../components/SupportPanel';
import { ago } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

const ROLE: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', STAFF: 'Team member' };

type Member = SupportShop['members'][number];
type Invitation = SupportShop['invitations'][number];

/** What support can do for a shop (§297). */
export type ShopAct =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'remove'; member: Member }
  | { kind: 'owner'; member: Member }
  | { kind: 'resend'; invitation: Invitation }
  | { kind: 'revoke'; invitation: Invitation };

/**
 * "Help with this shop" (§297): pause or open it, look after its team and its
 * invitations, hand it to a new owner — for an owner who cannot sign in, or
 * a team that cannot sort it out themselves.
 */
export function ShopSupportSection({
  businessId,
  onAct,
  onClose,
}: {
  businessId: string;
  onAct: (act: ShopAct) => void;
  onClose: () => void;
}) {
  const shop = useQuery({ queryKey: ['support-shop', businessId], queryFn: () => getSupportShop(businessId) });
  // Only the primary administrator may list administrators' invitations — the
  // same answer, from the server, to "may I hand a shop over?" (§242).
  const primary = useQuery({ queryKey: ['admin-invitations'], queryFn: listAdminInvitations, retry: false }).isSuccess;
  const s = shop.data;

  return (
    <section className="bz-section">
      <h4>
        <Icon name="help" size={16} />
        Help with this shop
      </h4>
      <p className="sa-intro">For when the owner cannot do it themselves. Each needs a reason, and the shop is told what was done.</p>
      {!s ? (
        <div className="skeleton sa-skel" />
      ) : (
        <>
          <div className="sa-acts">
            {s.pausedAt ? (
              <SupportActButton
                icon="zap"
                label="Open the shop again"
                note={`Paused ${ago(s.pausedAt)} — no new bookings`}
                onClick={() => onAct({ kind: 'resume' })}
              />
            ) : (
              <SupportActButton
                icon="pause"
                label="Pause the shop"
                note="No new bookings; the ones made still happen"
                onClick={() => onAct({ kind: 'pause' })}
              />
            )}
          </div>

          {/* The owner alone is already under People; the list is for acting on the others. */}
          {s.members.some((m) => m.role !== 'OWNER') && (
            <>
              <p className="ad-sub">The team</p>
              <ul className="sa-team">
                {s.members.map((m) => (
                  <li key={m.id}>
                    <Avatar label={m.email} size={34} />
                    <div>
                      <strong>{m.email}</strong>
                      <span>
                        {ROLE[m.role] ?? m.role}
                        {m.role !== 'OWNER' && !m.allLocations ? ' · some branches' : ''} · joined {ago(m.createdAt)}
                      </span>
                    </div>
                    {m.role !== 'OWNER' && (
                      <span className="sa-team-acts">
                        {primary && (
                          <button type="button" onClick={() => onAct({ kind: 'owner', member: m })} title="Hand the shop to them">
                            <Icon name="key" size={14} /> Make owner
                          </button>
                        )}
                        <button type="button" onClick={() => onAct({ kind: 'remove', member: m })}>
                          <Icon name="userX" size={14} /> Take out
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!primary && s.members.length > 1 && (
            <p className="sa-empty" style={{ marginTop: 8 }}>
              Handing the shop to a new owner is for the primary administrator.
            </p>
          )}

          {s.invitations.length > 0 && (
            <>
              <p className="ad-sub">Waiting to join</p>
              <ul className="sa-team">
                {s.invitations.map((i) => (
                  <li key={i.id}>
                    <Avatar label={i.email} size={34} />
                    <div>
                      <strong>{i.email}</strong>
                      <span className={i.expired ? 'is-late' : undefined}>
                        {ROLE[i.role] ?? i.role} · {i.expired ? 'the week to accept ran out' : `invited ${ago(i.createdAt)}`}
                      </span>
                    </div>
                    <span className="sa-team-acts">
                      <button type="button" onClick={() => onAct({ kind: 'resend', invitation: i })}>
                        <Icon name="send" size={14} /> Send again
                      </button>
                      <button type="button" onClick={() => onAct({ kind: 'revoke', invitation: i })}>
                        <Icon name="xCircle" size={14} /> Take back
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <SupportHistory filter={{ businessId }} onOpen={onClose} />
          </div>
        </>
      )}
    </section>
  );
}

/** One support action on a shop: what happens, and why. */
export function ShopActPanel({
  businessId,
  shopName,
  act,
  onBack,
  onClose,
}: {
  businessId: string;
  shopName: string;
  act: ShopAct;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const tickets = useOpenRequests({ businessId });
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['support-shop', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['support-history'] });
    void queryClient.invalidateQueries({ queryKey: ['business', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['businesses'] });
    onBack();
  };
  const common = { eyebrow: shopName, tickets, onBack, onClose, onDone: done };

  switch (act.kind) {
    case 'pause':
    case 'resume': {
      const pause = act.kind === 'pause';
      return (
        <SupportPanel
          {...common}
          title={pause ? 'Pause the shop' : 'Open the shop again'}
          consequences={
            pause
              ? [
                  { mark: 'pause', text: 'Customers cannot make new bookings. The shop stays in their past bookings and favourites.' },
                  { mark: 'calendar', text: 'Bookings already made still happen, and money already owed is still paid.' },
                  { mark: 'mail', text: 'The team is told, and can open it again themselves in Your shop.' },
                ]
              : [
                  { mark: 'zap', text: 'Customers can find and book the shop again.' },
                  { mark: 'mail', text: 'The team is told.' },
                ]
          }
          placeholder={
            pause ? 'The owner is travelling and cannot sign in; they asked us by phone.' : 'The owner is back and asked us to open it.'
          }
          confirmLabel={pause ? 'Pause it' : 'Open it'}
          run={(body) => supportPauseShop(businessId, pause, body)}
        />
      );
    }
    case 'remove':
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title="Take them out of the team"
          consequences={[
            {
              mark: <Avatar label={act.member.email} size={30} />,
              text: (
                <>
                  <strong>{act.member.email}</strong> can no longer open the shop — at once, even if signed in now.
                </>
              ),
            },
            { mark: 'calendar', text: 'What they did stays: bookings they handled still name them.' },
            { mark: 'mail', text: 'They are told, and so is the owner.' },
          ]}
          placeholder="They left the shop last month, and the owner cannot sign in to take them out."
          confirmLabel="Take them out"
          run={(body) => supportRemoveMember(businessId, act.member.id, body)}
        />
      );
    case 'owner':
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title={`Make ${act.member.email} the owner`}
          warning={
            <>
              <strong>This gives them the money and the keys.</strong> They can change the payout number and the team. You will be asked for
              a code first.
            </>
          }
          consequences={[
            {
              mark: <Avatar label={act.member.email} size={30} />,
              text: (
                <>
                  <strong>{act.member.email}</strong> becomes the owner, looking after every branch.
                </>
              ),
            },
            {
              mark: 'users',
              text: 'The old owner stays in the team, as a manager of every branch — the new owner can keep or remove them.',
            },
            { mark: 'mail', text: 'Both are told.' },
          ]}
          placeholder="The owner sold the shop to them; we checked the papers on the help request."
          minReason={10}
          confirmLabel="Make them the owner"
          run={(body) => supportTransferOwnership(businessId, { ...body, membershipId: act.member.id })}
        />
      );
    case 'resend':
      return (
        <SupportPanel
          {...common}
          title={`Send the invitation to ${act.invitation.email} again`}
          consequences={[
            {
              mark: 'send',
              text: <>The same invitation is emailed again, as {ROLE[act.invitation.role]?.toLowerCase() ?? 'a team member'}.</>,
            },
            { mark: 'clock', text: 'They get a fresh week to accept — by signing in with that email.' },
          ]}
          placeholder="The email went to their spam, and the week ran out."
          confirmLabel="Send it"
          run={(body) => supportResendInvitation(businessId, act.invitation.id, body)}
        />
      );
    case 'revoke':
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title={`Take back the invitation for ${act.invitation.email}`}
          consequences={[
            { mark: 'xCircle', text: 'They can no longer join with it.' },
            { mark: 'mail', text: 'The owner is told.' },
          ]}
          placeholder="It was sent to the wrong address."
          confirmLabel="Take it back"
          run={(body) => supportRevokeInvitation(businessId, act.invitation.id, body)}
        />
      );
  }
}
