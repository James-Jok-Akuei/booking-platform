import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { startConversation } from '../api/admin';
import { Icon } from '../ui/Icon';
import './write-first.css';

/**
 * Writing first to one customer or seller (§287) — as a support
 * conversation, so they can answer and both sides keep the record. They are
 * told the way they chose; the conversation opens under Support.
 */
export function WriteFirst({ userId, businessId, who }: { userId?: string; businessId?: string; who: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const start = useMutation({
    mutationFn: () => startConversation({ ...(userId ? { userId } : { businessId }), subject: subject.trim(), body: body.trim() }),
    onSuccess: (t) => navigate(`/tickets?status=ALL&open=${t.id}`),
  });

  if (!open) {
    return (
      <button type="button" className="wf-open" onClick={() => setOpen(true)}>
        <Icon name="send" size={15} /> Write to {who}
      </button>
    );
  }
  return (
    <div className="wf">
      <div className="wf-head">
        <strong>Write to {who}</strong>
        <span>It opens a support conversation they can answer. They are told the way they chose.</span>
      </div>
      <input value={subject} maxLength={200} placeholder="What it is about" onChange={(e) => setSubject(e.target.value)} />
      <textarea rows={4} value={body} maxLength={5000} placeholder="Your message" onChange={(e) => setBody(e.target.value)} />
      {start.error && (
        <p className="error" role="alert">
          {start.error instanceof ApiError ? start.error.message : 'That did not send.'}
        </p>
      )}
      <div className="wf-actions">
        <button type="button" onClick={() => setOpen(false)}>
          Not now
        </button>
        <button
          type="button"
          className="primary"
          disabled={start.isPending || subject.trim().length < 3 || !body.trim()}
          onClick={() => start.mutate()}
        >
          <Icon name="send" size={15} /> {start.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
