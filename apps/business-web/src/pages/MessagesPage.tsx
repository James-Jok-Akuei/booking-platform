import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listMessages, listThreads, markThreadRead, sendMessage, type Message, type Thread } from '../api/chat';
import { useThreadSocket } from '../useThreadSocket';
import { useMediaQuery } from '../shell/useMediaQuery';
import { ago, clock, relativeDay, sameDay } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { DropZone } from '../ui/DropZone';
import './messages.css';

/** What a thread is about, so eight threads with one customer are not eight identical rows. */
const subject = (thread: Thread) =>
  thread.appointment
    ? `${thread.appointment.serviceName}, ${new Date(thread.appointment.startTime).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })}`
    : 'A question, before booking';

const preview = (thread: Thread) =>
  thread.lastMessage?.hasPhoto && (!thread.lastMessage.preview || thread.lastMessage.preview === '[photo]')
    ? 'Sent a photo'
    : thread.lastMessage?.preview ?? '';

/**
 * Messages from customers (§21, §112, §198).
 *
 * An inbox in two panes: the conversations down the left, the open one on the
 * right. Unread counts are per PERSON, not per thread (§21.3), so what this
 * page shows is what YOU have not read.
 *
 * There is no "new message" button, and that is deliberate: a shop does not
 * cold-open a conversation with someone who has not contacted it. The server
 * has no endpoint for it either.
 *
 * The open conversation is in the address (`/messages?thread=…`, §230), so a
 * message pressed on Overview opens that very chat, and a reload keeps it.
 */
export function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('thread');
  // Moving between chats replaces the address rather than stacking it, so
  // Back leaves Messages instead of stepping through every chat read.
  const setOpenId = (id: string | null) =>
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        if (id) next.set('thread', id);
        else next.delete('thread');
        return next;
      },
      { replace: true },
    );
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');

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
  const rows = useMemo(
    () =>
      (threads.data?.threads ?? [])
        .filter((t) => t.lastMessage !== null)
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
    [threads.data],
  );
  const waiting = rows.filter((t) => t.unreadCount > 0).length;
  const shown = rows.filter((t) => {
    if (filter === 'unread' && t.unreadCount === 0) return false;
    const q = search.trim().toLowerCase();
    return !q || `${t.customer.email} ${subject(t)} ${preview(t)}`.toLowerCase().includes(q);
  });
  const open = rows.find((t) => t.id === openId) ?? null;

  // Arriving with a chat named, its row is brought into view in the list.
  const shownOnArrival = useRef(false);
  useEffect(() => {
    if (shownOnArrival.current || !openId || !threads.data) return;
    shownOnArrival.current = true;
    document.querySelector('.ms-thread.is-open')?.scrollIntoView({ block: 'nearest' });
  }, [openId, threads.data]);
  // On a phone the open conversation is the whole screen, drawn at the top of
  // the page so nothing around it can clip or trap it.
  const phone = useMediaQuery('(max-width: 860px)');

  return (
    <section className="ms">
      <div className="page-top">
        <header className="page-head ms-head">
          <div>
            <h1>Messages</h1>
            <p className="muted">
              Questions from customers, and anything said about a booking.
              {waiting > 0 && ` ${waiting} waiting for you.`}
            </p>
          </div>
        </header>
      </div>

      <div className={`ms-inbox${openId ? ' has-open' : ''}`}>
        <aside className="ms-list">
          <div className="ms-list-top">
            <label className="ms-search">
              <Icon name="search" size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
            </label>
            <div className="ms-filter" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={filter === 'all' ? 'is-on' : ''}
                onClick={() => setFilter('all')}
              >
                All <span>{rows.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'unread'}
                className={filter === 'unread' ? 'is-on' : ''}
                onClick={() => setFilter('unread')}
              >
                Unread {waiting > 0 && <span className="is-hot">{waiting}</span>}
              </button>
            </div>
          </div>

          <ul className="ms-threads">
            {threads.isLoading &&
              [0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <div className="skeleton ms-skeleton" />
                </li>
              ))}
            {shown.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className={`ms-thread${thread.id === openId ? ' is-open' : ''}${thread.unreadCount > 0 ? ' is-unread' : ''}`}
                  onClick={() => setOpenId(thread.id)}
                >
                  <Avatar label={thread.customer.email} size={44} />
                  <span className="ms-thread-text">
                    <span className="ms-thread-top">
                      <strong>{thread.customer.email}</strong>
                      {thread.lastMessageAt && <em>{ago(thread.lastMessageAt)}</em>}
                    </span>
                    <span className="ms-thread-subject">
                      <Icon name={thread.appointment ? 'calendar' : 'help'} size={12} />
                      {subject(thread)}
                    </span>
                    <span className="ms-thread-bottom">
                      <span className="ms-thread-preview">{preview(thread)}</span>
                      {thread.unreadCount > 0 && <i>{thread.unreadCount}</i>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {threads.data && rows.length === 0 && (
            <div className="ms-empty">
              <span>
                <Icon name="message" size={26} />
              </span>
              <p>
                No messages yet. Customers can write to you from your page in the app, before they book and
                about a booking they have made.
              </p>
            </div>
          )}
          {threads.data && rows.length > 0 && shown.length === 0 && (
            <p className="ms-none">{filter === 'unread' ? 'Nothing unread — all caught up.' : 'Nothing matches.'}</p>
          )}
        </aside>

        <div className="ms-pane">
          {openId && !phone ? (
            <Conversation key={openId} threadId={openId} thread={open} onBack={() => setOpenId(null)} />
          ) : (
            <div className="ms-welcome">
              <span>
                <Icon name="message" size={34} />
              </span>
              <h2>{waiting > 0 ? `${waiting} ${waiting === 1 ? 'conversation is' : 'conversations are'} waiting` : 'Choose a conversation'}</h2>
              <p>Pick one on the left to read it and reply. Replies reach the customer in their app straight away.</p>
            </div>
          )}
        </div>
      </div>

      {openId &&
        phone &&
        createPortal(
          <div className="ms-phone-chat">
            <Conversation key={openId} threadId={openId} thread={open} onBack={() => setOpenId(null)} />
          </div>,
          document.body,
        )}
    </section>
  );
}

function Conversation({ threadId, thread, onBack }: { threadId: string; thread: Thread | null; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => (photoUrl ? URL.revokeObjectURL(photoUrl) : undefined), [photoUrl]);
  const endRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const messages = useQuery({
    queryKey: ['thread-messages', threadId],
    queryFn: () => listMessages(threadId, { limit: 100 }),
    refetchInterval: 8000,
  });

  useThreadSocket(threadId);

  const list = messages.data?.messages ?? [];
  const count = list.length;

  // Tied to the messages arriving, not to the conversation opening: marking an
  // empty thread read would clear the badge for messages that had not loaded.
  useEffect(() => {
    if (count === 0) return;
    markThreadRead(threadId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['threads'] }))
      .catch(() => undefined);
  }, [threadId, count, queryClient]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  useEffect(() => box.current?.focus(), []);

  const send = useMutation({
    mutationFn: () =>
      sendMessage(threadId, {
        body: draft.trim() || undefined,
        ...(photo ? { photo } : {}),
      }),
    onSuccess: (message) => {
      setDraft('');
      setPhoto(null);
      queryClient.setQueryData(['thread-messages', threadId], (page: typeof messages.data) =>
        page && !page.messages.some((m) => m.id === message.id)
          ? { ...page, total: page.total + 1, messages: [...page.messages, message] }
          : page,
      );
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const canSend = (draft.trim().length > 0 || photo !== null) && !send.isPending;

  return (
    // A photo dropped anywhere on the conversation is attached, ready to send (§305).
    <DropZone className="ms-chat" onFiles={([file]) => setPhoto(file)} hint="Drop to attach the photo">
      <header className="ms-chat-head">
        <button type="button" className="ms-back" onClick={onBack} aria-label="Back to conversations">
          <Icon name="chevronLeft" size={20} />
        </button>
        <Avatar label={thread?.customer.email ?? 'Customer'} size={44} />
        <div className="ms-chat-who">
          <strong>{thread?.customer.email ?? 'Conversation'}</strong>
          <span>{thread ? subject(thread) : ''}</span>
        </div>
        {thread?.appointment && (
          <span className="ms-booking">
            <Icon name="calendarCheck" size={15} />
            {thread.appointment.status.replace('_', ' ').toLowerCase()}
          </span>
        )}
      </header>

      <div className="ms-log">
        {messages.isLoading && <div className="skeleton ms-log-skeleton" />}
        {messages.data && count === 0 && <p className="ms-none">Nothing in this conversation yet.</p>}
        {list.map((message, i) => {
          const prev = list[i - 1];
          const next = list[i + 1];
          const newDay = !prev || !sameDay(new Date(prev.createdAt), new Date(message.createdAt));
          const fromUs = message.sender.role !== 'CUSTOMER';
          // A run of messages from one person reads as one block, with who
          // and when said once, under the last of them.
          const sameSender = Boolean(prev) && !newDay && prev.sender.id === message.sender.id;
          const runGoesOn =
            Boolean(next) && next.sender.id === message.sender.id && sameDay(new Date(next.createdAt), new Date(message.createdAt));
          return (
            <div key={message.id}>
              {newDay && (
                <div className="ms-day">
                  <span>{relativeDay(message.createdAt)}</span>
                </div>
              )}
              <Bubble message={message} fromUs={fromUs} grouped={sameSender} showMeta={!runGoesOn} />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {send.isError && (
        <p className="ms-send-error" role="alert">
          {send.error instanceof ApiError ? send.error.message : 'Not sent. Try again.'}
        </p>
      )}

      <div className="ms-composer">
        {photoUrl && (
          <div className="ms-attached">
            <img src={photoUrl} alt="" />
            <span>{photo?.name}</span>
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove the photo">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        <div className="ms-compose-row">
          <label className="ms-attach" htmlFor="chat-photo" title="Attach a photo">
            <Icon name="paperclip" size={19} />
            <span className="visually-hidden">Attach a photo</span>
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
          <textarea
            ref={box}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (canSend) send.mutate();
              }
            }}
            placeholder="Write a reply"
            maxLength={2000}
            rows={1}
          />
          <button
            type="button"
            className="ms-send"
            disabled={!canSend}
            onClick={() => send.mutate()}
            aria-label="Send"
          >
            {send.isPending ? <span className="ci-spinner" /> : <Icon name="send" size={18} />}
          </button>
        </div>
        <p className="ms-hint">
          Enter to send · Shift + Enter for a new line<span className="drop-tip"> · drop a photo to attach it</span>
        </p>
      </div>
    </DropZone>
  );
}

function Bubble({
  message,
  fromUs,
  grouped,
  showMeta,
}: {
  message: Message;
  fromUs: boolean;
  grouped: boolean;
  showMeta: boolean;
}) {
  return (
    <div className={`ms-line${fromUs ? ' ours' : ' theirs'}${grouped ? ' is-grouped' : ''}`}>
      <div className="ms-bubble">
        {message.photoUrl && (
          <a href={message.photoUrl} target="_blank" rel="noreferrer">
            <img src={message.photoUrl} alt="" className="ms-photo" />
          </a>
        )}
        {message.body && <p>{message.body}</p>}
      </div>
      {showMeta && (
        <span className="ms-meta">
          {/* Whose reply, by name, because several people here can answer (§14).
              The customer's side never sees these addresses (§112.1). */}
          {fromUs ? message.sender.email : 'Customer'} · {clock(message.createdAt)}
        </span>
      )}
    </div>
  );
}
