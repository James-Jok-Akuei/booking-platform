import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listBanners } from '../api/business';
import { Icon } from '../ui/Icon';

const KEY = 'booking-business.banners-closed';
const readClosed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/**
 * A service notice from the platform's team across the top of every page
 * (§287) — "MTN MoMo is slow this morning" — until it ends or is closed.
 */
export function NoticeBanner() {
  const banners = useQuery({ queryKey: ['banners'], queryFn: listBanners, refetchInterval: 5 * 60_000 });
  const [closed, setClosed] = useState(readClosed);
  const showing = (banners.data?.banners ?? []).filter((b) => !closed.includes(b.id));
  if (showing.length === 0) return null;
  const b = showing[0];
  const close = () => {
    const next = [...closed, b.id].slice(-20);
    setClosed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A private window: closed for now only.
    }
  };
  return (
    <aside className="notice-banner" role="status">
      <span className="notice-banner-mark" aria-hidden="true">
        <Icon name="megaphone" size={17} />
      </span>
      <div>
        <strong>{b.title}</strong>
        <span>{b.body}</span>
      </div>
      {b.linkPath && (
        <Link to={b.linkPath} className="notice-banner-link">
          {b.linkLabel || 'See more'} <Icon name="external" size={13} />
        </Link>
      )}
      <button type="button" className="notice-banner-close" onClick={close} aria-label="Close this notice">
        <Icon name="close" size={15} />
      </button>
    </aside>
  );
}
