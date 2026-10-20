import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  supportCancelForCustomer,
  supportCancelForShop,
  supportCheckIn,
  supportCheckPayment,
  supportComplete,
  supportFixNoShow,
  supportReadMessages,
  supportReadPrivateAnswers,
  supportResendCode,
  type AdminAppointmentDetail,
  type SupportBody,
  type SupportConversation,
  type SupportPrivateAnswers,
} from '../api/admin';
import { SupportActButton, SupportHistory, SupportPanel, type Consequence } from '../components/SupportPanel';
import { reservationNo } from '../lib/bookingLook';
import { clock, shortDay } from '../lib/time';
import { useMoney } from '../money';
import { Avatar } from '../ui/Avatar';
import { alertDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { ShopMark } from '../ui/ShopMark';

/** What support can do to a booking (§297), each one a form. */
export type BookingAct =
  | 'checkIn'
  | 'complete'
  | 'fixNoShow'
  | 'cancelForCustomer'
  | 'cancelForShop'
  | 'resendCode'
  | 'readMessages'
  | 'readPrivate';

/**
 * "Help with this booking" (§297): what support may do for the shop or the
 * customer, from the booking's state — the server's own rule (supportOptions),
 * so a button is never shown for something it would refuse.
 */
export function BookingSupportSection({
  a,
  onAct,
  onClose,
}: {
  a: AdminAppointmentDetail;
  onAct: (act: BookingAct) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const can = a.support;
  const reclassify = a.status !== 'BOOKED' && a.status !== 'PENDING_PAYMENT' && a.status !== 'NO_SHOW';

  // A question, not a change: no reason asked, and the answer is said at once.
  const ask = useMutation({
    mutationFn: () => supportCheckPayment(a.id, a.tickets[0]?.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-appointment', a.id] });
      void queryClient.invalidateQueries({ queryKey: ['support-history'] });
      const paid = result.paymentStatus === 'SUCCESSFUL';
      void alertDialog({
        tone: paid ? 'ok' : result.paymentStatus === 'FAILED' ? 'danger' : 'info',
        title: paid
          ? 'Paid — the booking is confirmed'
          : result.paymentStatus === 'FAILED'
            ? 'The payment did not go through'
            : 'Still waiting for the customer',
        body: paid
          ? 'The operator says the deposit was paid. The booking is now confirmed, and both were told.'
          : result.paymentStatus === 'FAILED'
            ? `The operator says it failed${result.failureReason ? `: ${result.failureReason}` : ''}. The customer can try again from the app.`
            : 'The operator has no answer yet — the customer may not have approved it on their phone.',
      });
    },
    onError: (error) =>
      void alertDialog({
        tone: 'danger',
        title: 'The operator could not be asked',
        body: error instanceof ApiError ? error.message : 'Try again in a minute.',
      }),
  });

  const acts: ReactNode[] = [];
  if (can.checkIn)
    acts.push(
      <SupportActButton key="in" icon="userCheck" label="Check the customer in" note="The shop’s app failed, or the code was locked" onClick={() => onAct('checkIn')} />,
    );
  if (can.complete)
    acts.push(
      <SupportActButton key="done" icon="checkCircle" label="Mark it done" note="The service happened; the shop could not close it" onClick={() => onAct('complete')} />,
    );
  if (can.resendCode)
    acts.push(
      <SupportActButton key="code" icon="mail" label="Send a new arrival code" note="Theirs never arrived, or is lost" onClick={() => onAct('resendCode')} />,
    );
  if (can.checkPayment)
    acts.push(
      <SupportActButton
        key="pay"
        icon="phone"
        label={ask.isPending ? 'Asking the operator…' : 'Ask the operator about the payment'}
        note="They say they paid; the booking still waits"
        onClick={() => !ask.isPending && ask.mutate()}
      />,
    );
  if (can.fixNoShow)
    acts.push(
      <SupportActButton key="ns" icon="userCheck" label="They came — change “missed” to done" note="Marked missed by mistake" onClick={() => onAct('fixNoShow')} />,
    );
  if (can.cancelForCustomer)
    acts.push(
      <SupportActButton key="cc" icon="calendarX" tone="danger" label="Cancel for the customer" note="They asked us; their app would not" onClick={() => onAct('cancelForCustomer')} />,
    );
  if (can.cancelForShop)
    acts.push(
      <SupportActButton
        key="cs"
        icon="refresh"
        tone="danger"
        label={reclassify ? 'Put the cancellation on the shop' : 'Cancel for the shop'}
        note={a.depositPaid ? 'The customer gets the whole deposit back' : 'It counts as the shop’s cancellation'}
        onClick={() => onAct('cancelForShop')}
      />,
    );
  acts.push(
    <SupportActButton key="chat" icon="eye" label="Read their conversation" note="What the customer and the shop said — it is written down" onClick={() => onAct('readMessages')} />,
  );
  // Allergies, a health matter (§300.6): only with a reason, and both are told.
  if (a.hasHealthChoices)
    acts.push(
      <SupportActButton key="private" icon="lock" label="Read the private answers" note="Health or personal — only with a reason; it is written down" onClick={() => onAct('readPrivate')} />,
    );

  return (
    <>
      <section className="ad-section">
        <h4>
          <Icon name="help" size={15} />
          Help with this booking
        </h4>
        <p className="sa-intro">
          For when the shop or the customer cannot do it themselves. Each needs a reason, and both are told what was done.
        </p>
        <div className="sa-acts">{acts}</div>
      </section>
      <section className="ad-section">
        <SupportHistory filter={{ appointmentId: a.id }} onOpen={onClose} />
      </section>
    </>
  );
}

/** One support action on a booking: what happens, why, and the help request it answers. */
export function BookingActPanel({
  a,
  act,
  onBack,
  onClose,
  onRead,
  onReadPrivate,
}: {
  a: AdminAppointmentDetail;
  act: BookingAct;
  onBack: () => void;
  onClose: () => void;
  onRead: (conversation: SupportConversation) => void;
  /** The private answers, once read (§300.6). */
  onReadPrivate: (answers: SupportPrivateAnswers) => void;
}) {
  const money = useMoney();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [charge, setCharge] = useState('0');

  const customer = a.customerDisplayName || a.customerEmail;
  const shop = a.businessName ?? 'The shop';
  const deposit = money.format(a.depositAmountMinor, a.currency);
  const factor = 10 ** money.exponent;
  const chargeMinor = Math.round(Number(charge) * factor);
  const chargeValid = charge.trim() !== '' && Number.isFinite(Number(charge)) && Number(charge) >= 0 && Number.isInteger(chargeMinor);
  const codeValid = code === '' || /^\d{6}$/.test(code);

  const face: ReactNode = <Avatar label={customer} size={30} />;
  const shopFace: ReactNode = <ShopMark name={a.businessName} logoUrl={a.businessLogoUrl} size={30} />;
  const when = `${shortDay(a.startTime)}, ${clock(a.startTime)}`;
  const eyebrow = `Booking No. ${reservationNo(a.id)} · ${a.serviceName}`;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-appointment', a.id] });
    void queryClient.invalidateQueries({ queryKey: ['support-history'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    void queryClient.invalidateQueries({ queryKey: ['held'] });
  };

  const codeField = (
    <label>
      <span>Their arrival code, if they read it to you</span>
      <input
        className="sa-code"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        placeholder="000000"
        aria-label="The arrival code"
      />
      <small>
        {code && !codeValid
          ? 'Six digits.'
          : 'Without it, say how you know they came — the shop confirmed it on the phone, say — in at least 10 letters.'}
      </small>
    </label>
  );

  const common = {
    tickets: a.tickets,
    onBack,
    onClose,
    eyebrow,
    noTicketHint: 'If they wrote in about it, tie their request to this booking first (in Support), so the note reaches them there.',
  };
  const done = () => {
    refresh();
    onBack();
  };

  switch (act) {
    case 'checkIn':
      return (
        <SupportPanel
          {...common}
          title="Check the customer in"
          consequences={[
            { mark: face, text: <><strong>{customer}</strong> is checked in for {when}, as if the shop typed their code.</> },
            { mark: shopFace, text: <><strong>{shop}</strong> is told, and marks it done when the service is finished.</> },
            { mark: 'banknote', text: 'No money moves now.' },
          ]}
          placeholder="The shop’s app would not open; the customer read us their code on the phone."
          minReason={code ? 5 : 10}
          extra={codeField}
          ready={codeValid}
          confirmLabel="Check them in"
          run={(body: SupportBody) => supportCheckIn(a.id, { ...body, ...(code ? { code } : {}) })}
          onDone={done}
        />
      );
    case 'complete':
      return (
        <SupportPanel
          {...common}
          title="Mark it done"
          consequences={[
            ...(a.status === 'BOOKED'
              ? [{ mark: face, text: <><strong>{customer}</strong> is checked in first.</> } as Consequence]
              : []),
            {
              mark: shopFace,
              text: a.depositPaid ? (
                <>
                  <strong>{shop}</strong>’s share, <b className="is-ok">{money.format(a.businessAmountMinor, a.currency)}</b>, is paid with
                  its next payout, after the usual wait.
                </>
              ) : (
                <>No deposit was paid, so no money moves.</>
              ),
            },
            { mark: 'star', text: 'The customer is asked how it went.' },
          ]}
          placeholder="The service happened; the shop’s app failed before they could close it."
          minReason={a.status === 'BOOKED' && !code ? 10 : 5}
          extra={a.status === 'BOOKED' ? codeField : undefined}
          ready={codeValid}
          confirmLabel="Mark it done"
          run={(body) => supportComplete(a.id, { ...body, ...(code ? { code } : {}) })}
          onDone={done}
        />
      );
    case 'fixNoShow':
      return (
        <SupportPanel
          {...common}
          title="They came — change “missed” to done"
          consequences={[
            { mark: face, text: <><strong>{customer}</strong>’s booking becomes done, not missed.</> },
            { mark: 'banknote', text: 'The money stays as it is — the shop keeps its share either way.' },
            { mark: 'star', text: 'The customer is asked how it went, and can leave a review.' },
          ]}
          placeholder="The shop confirms the customer came; it was marked missed by mistake."
          confirmLabel="Change it to done"
          run={(body) => supportFixNoShow(a.id, body)}
          onDone={done}
        />
      );
    case 'cancelForCustomer':
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title="Cancel for the customer"
          consequences={[
            {
              mark: face,
              text: a.depositPaid ? (
                <>
                  <strong>{customer}</strong>’s deposit, <b>{deposit}</b>, is not given back — as when they cancel themselves.
                </>
              ) : (
                <>No deposit was paid, so no money moves.</>
              ),
            },
            { mark: shopFace, text: <><strong>{shop}</strong> keeps its share, and the time opens for others to book.</> },
            { mark: 'mail', text: 'Both are told it was cancelled by our support team, for the customer.' },
          ]}
          placeholder="The customer called: they are ill, and their app would not open."
          confirmLabel="Cancel the booking"
          busyLabel="Cancelling…"
          run={(body) => supportCancelForCustomer(a.id, body)}
          onDone={done}
        />
      );
    case 'cancelForShop': {
      const live = a.status === 'BOOKED' || a.status === 'PENDING_PAYMENT' || a.status === 'NO_SHOW';
      return (
        <SupportPanel
          {...common}
          tone="danger"
          title={live ? 'Cancel for the shop' : 'Put this cancellation on the shop'}
          warning={
            a.depositPaid ? (
              <>
                <strong>This moves money, and cannot be undone.</strong> There is no way to put it back on the customer afterwards.
              </>
            ) : undefined
          }
          consequences={
            a.depositPaid
              ? [
                  {
                    mark: face,
                    text: (
                      <>
                        <strong>{customer}</strong> gets back <b>{deposit}</b> — the whole deposit, the platform fee of{' '}
                        {money.format(a.platformFeeAmountMinor, a.currency)} included.
                      </>
                    ),
                  },
                  {
                    mark: shopFace,
                    text: (
                      <>
                        <strong>{shop}</strong> loses the {money.format(a.businessAmountMinor, a.currency)} it was owed, and carries the gateway
                        fee — what the operator charges to send the refund.
                      </>
                    ),
                  },
                  { mark: 'mail', text: 'Both are told, with the reason you write below.' },
                ]
              : [
                  { mark: 'banknote', text: 'No deposit was paid, so no money moves.' },
                  { mark: shopFace, text: <>It counts as <strong>{shop}</strong>’s cancellation.</> },
                  { mark: 'mail', text: 'Both are told, with the reason you write below.' },
                ]
          }
          placeholder={
            a.status === 'NO_SHOW'
              ? 'The customer came, but the shop was closed and marked them missed.'
              : live
                ? 'The shop is closed today — the owner is ill and asked us to cancel.'
                : 'The shop was closed when the customer arrived, and asked them to cancel.'
          }
          extra={
            a.depositPaid ? (
              <label>
                <span>The gateway fee: what the operator charged to send the refund</span>
                <div className="ad-amount">
                  <b>{money.code || a.currency}</b>
                  <input value={charge} onChange={(event) => setCharge(event.target.value)} inputMode="decimal" aria-label="The operator's charge" />
                </div>
                <small>From the operator’s statement. Write 0 if there was none — a guess here is carried by the shop.</small>
              </label>
            ) : undefined
          }
          ready={!a.depositPaid || chargeValid}
          confirmLabel={a.depositPaid ? `Refund ${deposit}` : 'Cancel for the shop'}
          busyLabel={a.depositPaid ? 'Refunding…' : 'Cancelling…'}
          run={(body) => supportCancelForShop(a.id, { ...body, ...(a.depositPaid ? { gatewayChargeMinor: chargeMinor } : {}) })}
          onDone={done}
        />
      );
    }
    case 'resendCode':
      return (
        <SupportPanel
          {...common}
          title="Send a new arrival code"
          consequences={[
            { mark: face, text: <>A new code is emailed to <strong>{a.customerEmail}</strong>. The old one stops working.</> },
            { mark: 'eyeOff', text: 'We never see the code — only they do.' },
          ]}
          placeholder="The customer never got the email with their code."
          confirmLabel="Send it"
          busyLabel="Sending…"
          run={(body) => supportResendCode(a.id, body)}
          onDone={done}
        />
      );
    case 'readMessages':
      return (
        <SupportPanel
          {...common}
          title="Read their conversation"
          consequences={[
            { mark: 'eye', text: 'You see every message between the customer and the shop about this booking, as they wrote them.' },
            { mark: 'shield', text: 'That you read it is written down, and shows on the booking for both of them.' },
          ]}
          placeholder="The customer says the shop agreed to move the time in the chat."
          confirmLabel="Read it"
          busyLabel="Opening…"
          run={(body) => supportReadMessages(a.id, body)}
          onDone={(result) => {
            refresh();
            onRead(result as SupportConversation);
          }}
        />
      );
    case 'readPrivate':
      return (
        <SupportPanel
          {...common}
          title="Read the private answers"
          consequences={[
            { mark: 'lock', text: 'Allergies, health or something personal the customer told the shop — sealed, and kept only 30 days after the visit.' },
            { mark: 'shield', text: 'That you read them is written down, with your reason, and shows on the booking for both of them.' },
          ]}
          placeholder="The shop asks what allergy the customer said; the booking will not open for them."
          confirmLabel="Read them"
          busyLabel="Opening…"
          run={(body) => supportReadPrivateAnswers(a.id, body)}
          onDone={(result) => {
            refresh();
            onReadPrivate(result as SupportPrivateAnswers);
          }}
        />
      );
  }
}

/** The private answers on a booking, as support reads them (§300.6). */
export function PrivateAnswersPanel({
  a,
  read,
  onBack,
  onClose,
}: {
  a: AdminAppointmentDetail;
  read: SupportPrivateAnswers;
  onBack: () => void;
  onClose: () => void;
}) {
  const byGroup = new Map<string, string[]>();
  for (const answer of read.answers ?? []) byGroup.set(answer.group, [...(byGroup.get(answer.group) ?? []), answer.option]);
  return (
    <Panel
      eyebrow={`Booking No. ${reservationNo(a.id)} · read by support`}
      title="The private answers"
      onClose={onClose}
      width={560}
      footer={
        <button type="button" onClick={onBack}>
          Back to the booking
        </button>
      }
    >
      {byGroup.size === 0 ? (
        <p className="sa-empty">
          {read.removedAt ? 'They were removed 30 days after the visit, as promised.' : 'There are none on this booking.'}
        </p>
      ) : (
        <div className="sa-private">
          <p>
            <Icon name="lock" size={15} /> For helping with this booking only — never copy them into a message or a note.
          </p>
          {[...byGroup.entries()].map(([group, options]) => (
            <div key={group}>
              <span>{group}</span>
              <strong>{options.join(', ')}</strong>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** The conversation, read-only, as support reads it (§297). */
export function ConversationPanel({
  a,
  conversation,
  onBack,
  onClose,
}: {
  a: AdminAppointmentDetail;
  conversation: SupportConversation;
  onBack: () => void;
  onClose: () => void;
}) {
  let lastDay = '';
  return (
    <Panel
      eyebrow={`Booking No. ${reservationNo(a.id)} · read by support`}
      title="Their conversation"
      onClose={onClose}
      width={640}
      footer={
        <button type="button" onClick={onBack}>
          Back to the booking
        </button>
      }
    >
      <p className="sa-chat-who">
        <span>
          <i style={{ background: 'var(--sunken-2)' }} />
          {a.customerDisplayName || a.customerEmail}
        </span>
        <span>
          <i style={{ background: 'var(--ask-soft)' }} />
          {a.businessName ?? 'The shop'}
        </span>
      </p>
      {conversation.messages.length === 0 ? (
        <p className="sa-empty">
          {conversation.threadId ? 'They have not written to each other yet.' : 'There is no conversation about this booking.'}
        </p>
      ) : (
        <div className="sa-chat">
          {conversation.messages.map((m) => {
            const day = shortDay(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <span className="sa-chat-day">{day}</span>}
                <div className={`sa-bubble is-${m.from}`}>
                  {m.photoUrl && <img src={m.photoUrl} alt="" />}
                  {m.body && <p>{m.body}</p>}
                  <small>
                    {m.from === 'shop' ? m.senderEmail : 'Customer'} · {clock(m.createdAt)}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
