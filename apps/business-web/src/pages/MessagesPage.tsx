import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listMessages,
  listThreads,
  markThreadRead,
  sendMessage,
  type Message,
  type Thread,
} from '../api/chat';
import { useThreadSocket } from '../useThreadSocket';

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What a thread is about, so eight threads with one customer are not eight identical rows. */
const subject = (thread: Thread) =>
  thread.appointment
    ? `${thread.appointment.serviceName}, ${new Date(
        thread.appointment.startTime,
      ).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : 'A question, before booking';

/**
 * Messages from customers.
 *
 * Unread counts are per PERSON, not per thread (§21.3), so what this page shows
 * is what YOU have not read. An owner glancing at a conversation does not clear
 * the badge for the staff member who actually has to answer it — which is the
 * whole reason read state is a row per reader rather than a flag on the thread.
 *
 * There is no "new message" button, and that is deliberate: a shop does not
 * cold-open a conversation with someone who has not contacted it. The server
 * has no endpoint for it either.
 */
export function MessagesPage() {
  const [openId, setOpenId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => listThreads({ limit: 100 }),
    // A shop leaves this tab open all day, so the list refreshes itself. The
    // open conversation has its own socket; this is for the ones that are not.
    refetchInterval: 30_000,
  });

  // A thread that was created with a booking and never used is noise: one is
  // made with EVERY appointment (§21.1), so a busy week would bury the real
  // conversations under empty ones.
  const rows = (threads.data?.threads ?? []).filter((t) => t.lastMessage !== null);
  const waiting = rows.filter((t) => t.unreadCount > 0).length;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="muted">
            Questions from customers, and anything said about a booking.
            {waiting > 0 && ` ${waiting} waiting for you.`}
          </p>
        </div>
      </header>

      {threads.isLoading && <p className="muted">Loading…</p>}

      {threads.data && rows.length === 0 && (
        <p className="muted empty">
          No messages yet. Customers can write to you from your page in the app,
          before they book and about a booking they have made.
        </p>
      )}

      <ul className="card-list">
        {rows.map((thread) => (
          <li key={thread.id}>
            <button type="button" className="card-row" onClick={() => setOpenId(thread.id)}>
              <div>
                <strong>{thread.customer.email}</strong>
                <div className="muted small">{subject(thread)}</div>
                <div className="muted small">
                  {thread.lastMessage?.preview ??
                    (thread.lastMessage?.hasPhoto ? 'Sent a photo' : '')}
                </div>
              </div>
              <div className="row-status">
                {thread.unreadCount > 0 && (
                  <span className="pill warn">{thread.unreadCount} unread</span>
                )}
                {thread.lastMessageAt && (
                  <span className="muted small">{ago(thread.lastMessageAt)}</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {openId && (
        <ThreadDrawer
          threadId={openId}
          thread={rows.find((t) => t.id === openId) ?? null}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

function ThreadDrawer({
  threadId,
  thread,
  onClose,
}: {
  threadId: string;
  thread: Thread | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ['thread-messages', threadId],
    queryFn: () => listMessages(threadId, { limit: 100 }),
    refetchInterval: 8000,
  });

  useThreadSocket(threadId);

  const count = messages.data?.messages.length ?? 0;

  // Tied to the messages arriving, not to the drawer opening: marking an empty
  // thread read would clear the badge for messages that had not loaded.
  useEffect(() => {
    if (count === 0) return;
    markThreadRead(threadId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['threads'] }))
      .catch(() => undefined);
  }, [threadId, count, queryClient]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = useMutation({
    mutationFn: () =>
      sendMessage(threadId, {
        body: draft.trim() || undefined,
        ...(photo ? { photo } : {}),
      }),
    onSuccess: (message) => {
      setDraft('');
      setPhoto(null);
      queryClient.setQueryData(
        ['thread-messages', threadId],
        (page: typeof messages.data) =>
          page && !page.messages.some((m) => m.id === message.id)
            ? { ...page, total: page.total + 1, messages: [...page.messages, message] }
            : page,
      );
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const canSend = (draft.trim().length > 0 || photo !== null) && !send.isPending;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer chat-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>{thread?.customer.email ?? 'Conversation'}</h2>
            <p className="muted small">{thread ? subject(thread) : ''}</p>
          </div>
          <button type="button" className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="chat-log">
          {messages.isLoading && <p className="muted">Loading…</p>}
          {messages.data?.messages.length === 0 && (
            <p className="muted empty">Nothing in this conversation yet.</p>
          )}
          {messages.data?.messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
          <div ref={endRef} />
        </div>

        {send.isError && (
          <p className="error">
            {send.error instanceof ApiError ? send.error.message : 'Not sent. Try again.'}
          </p>
        )}

        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a reply"
            maxLength={2000}
            rows={3}
          />
          <div className="chat-actions">
            <label className="link" htmlFor="chat-photo">
              {photo ? photo.name : 'Attach a photo'}
            </label>
            <input
              id="chat-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                // Cleared so picking the same file twice still fires (§83).
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={!canSend}
              onClick={() => send.mutate()}
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const fromUs = message.sender.role !== 'CUSTOMER';
  return (
    <div className={fromUs ? 'chat-line ours' : 'chat-line theirs'}>
      <div className="chat-bubble">
        {message.photoUrl && (
          <a href={message.photoUrl} target="_blank" rel="noreferrer">
            <img src={message.photoUrl} alt="" className="chat-photo" />
          </a>
        )}
        {message.body && <p>{message.body}</p>}
        <span className="muted small">
          {/* Whose reply, by name, because several people here can answer (§14).
              The customer's side never sees these addresses (§112.1). */}
          {fromUs ? message.sender.email : 'Customer'} · {clock(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
