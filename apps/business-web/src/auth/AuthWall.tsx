import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wallServices } from '../api/business';
import { Icon, type IconName } from '../ui/Icon';

/** Each tile's height as a multiple of its column's width: a rhythm, not a grid (§183). */
const SHAPES = [1.32, 1.02, 1.22, 0.94, 1.38, 1.1];
/** The wall's turn, as in the customer app. */
const TILT = (10 * Math.PI) / 180;
/** Pixels a second. Slow enough to be a backdrop, not a slideshow. */
const SPEED = 15;
/** The least a column glides before it turns back, so it is seen to move. */
const MIN_TRAVEL = 140;
/** The narrowest a column may be, so a tile stays a photo rather than a stamp — narrower on a phone. */
const minColumn = (frameW: number) => (frameW < 700 ? 115 : 170);
/** However many shops there are, the wall stays light. */
const MOST_TILES = 40;

type Tile = { key: string; src: string | null; icon: IconName | null; tone: string | null };

/** The kinds of place on the platform, for one with too few photos yet. */
const STAND_INS: Array<{ icon: IconName; tone: string }> = [
  { icon: 'scissors', tone: 'coral' },
  { icon: 'sparkles', tone: 'violet' },
  { icon: 'camera', tone: 'blue' },
  { icon: 'store', tone: 'green' },
  { icon: 'star', tone: 'gold' },
  { icon: 'calendarCheck', tone: 'coral' },
  { icon: 'users', tone: 'teal' },
  { icon: 'globe', tone: 'blue' },
];

type Column = { tiles: Tile[]; heights: number[]; length: number; travel: number };
type Plan = { wallW: number; wallH: number; gap: number; width: number; columns: Column[]; moving: boolean };

/**
 * How the wall is laid out in a frame (§238), so that NO PHOTO IS EVER SHOWN
 * TWICE.
 *
 * The customer app loops each column, drawn twice end to end, and repeats its
 * photos to fill the columns — so on a wide screen the same picture can be in
 * view twice at once. Here every photo is on the wall exactly once: each
 * column glides one way and back, never wrapping, so a column only has to be
 * longer than the window it is seen through. Tiles go round the columns in
 * order — the most booked first, across the top. The most columns that
 * still cover the frame AND have room to move win; with too few photos for
 * even that, the wall holds still and each photo breathes in place instead.
 */
export function planWall(tiles: Tile[], frameW: number, frameH: number, gap: number): Plan | null {
  if (tiles.length === 0 || frameW < 20 || frameH < 20) return null;
  // The turned wall must still cover the frame's corners.
  const wallW = Math.ceil(frameW * Math.cos(TILT) + frameH * Math.sin(TILT)) + gap * 2;
  const wallH = Math.ceil(frameW * Math.sin(TILT) + frameH * Math.cos(TILT)) + gap * 2;

  const build = (count: number) => {
    const width = (wallW - gap * (count - 1)) / count;
    const columns = Array.from({ length: count }, (_, c): Column => {
      const mine = tiles.filter((_, i) => i % count === c);
      const heights = mine.map((_, i) => Math.round(width * SHAPES[(i + c * 2) % SHAPES.length]));
      const length = heights.reduce((sum, h) => sum + h + gap, 0) - gap;
      return { tiles: mine, heights, length, travel: Math.max(0, length - wallH) };
    });
    return { width, columns };
  };

  const most = Math.max(1, Math.min(6, Math.floor((wallW + gap) / (minColumn(frameW) + gap))));
  for (let count = most; count >= 1; count--) {
    const { width, columns } = build(count);
    if (columns.every((column) => column.tiles.length > 0 && column.travel >= MIN_TRAVEL)) {
      return { wallW, wallH, gap, width, columns, moving: true };
    }
  }
  // Too few to cover the frame and still move: a still wall, about as many
  // columns as the photos fill evenly.
  const count = Math.max(1, Math.min(most, Math.round(Math.sqrt((tiles.length * wallW) / (wallH * 1.16)))));
  const { width, columns } = build(count);
  return { wallW, wallH, gap, width, columns, moving: false };
}

/**
 * The picture behind signing in (§238): the customer app's wall (§183) on a
 * bigger screen — real photos of the services shops have put up, in columns
 * turned a little, gliding past each other under a warm coral-to-night
 * shade, so the words over them read.
 *
 * Real photos are the most convincing thing this screen can show: these are
 * the shops already taking bookings here. Until six are known (a new
 * platform, no signal) the kinds of place on it stand in. Each photo fades
 * in as it arrives rather than popping, and "reduce motion" holds it all
 * still.
 */
export function AuthWall() {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const services = useQuery({
    queryKey: ['auth-wall'],
    queryFn: wallServices,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const tiles = useMemo<Tile[]>(() => {
    const seen = new Set<string>();
    const photos: Tile[] = [];
    for (const service of services.data?.services ?? []) {
      // The service's own photo only: a shop's cover is often its logo, or a
      // banner with words on it, which reads as noise behind a headline.
      const src = service.imageUrl;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      photos.push({ key: src, src, icon: null, tone: null });
      if (photos.length === MOST_TILES) break;
    }
    if (photos.length >= 6) return photos;
    if (services.isPending) return [];
    return STAND_INS.map((s) => ({ key: s.icon, src: null, icon: s.icon, tone: s.tone }));
  }, [services.data, services.isPending]);

  const gap = size.w < 700 ? 10 : 14;
  const plan = useMemo(() => planWall(tiles, size.w, size.h, gap), [tiles, size.w, size.h, gap]);

  return (
    <div className="au-wall-frame" ref={frame} aria-hidden="true">
      {plan && (
        <div className="au-wall-drift">
          <div
            className={`au-wall${plan.moving ? ' is-moving' : ' is-still'}`}
            style={
              {
                width: plan.wallW,
                height: plan.wallH,
                left: (size.w - plan.wallW) / 2,
                top: (size.h - plan.wallH) / 2,
                gap: plan.gap,
                '--tile-r': `${Math.round(plan.gap * 1.7)}px`,
              } as CSSProperties
            }
          >
            {plan.columns.map((column, c) => {
              const seconds = column.travel / SPEED;
              return (
                <div
                  key={c}
                  className="au-col"
                  style={
                    {
                      width: plan.width,
                      gap: plan.gap,
                      '--travel': `${column.travel}px`,
                      // Neighbours glide opposite ways, each from its own point.
                      animationDuration: `${seconds.toFixed(1)}s`,
                      animationDelay: `-${(seconds * ((c * 0.37) % 1)).toFixed(1)}s`,
                      animationDirection: c % 2 === 0 ? 'alternate' : 'alternate-reverse',
                    } as CSSProperties
                  }
                >
                  {column.tiles.map((tile, i) => (
                    <WallTile key={tile.key} tile={tile} height={column.heights[i]} breathe={(c * 3 + i) % 7} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Night rising from the bottom, where the words sit; the app's coral,
          warm from the top corner. */}
      <div className="au-wall-shade" />
    </div>
  );
}

function WallTile({ tile, height, breathe }: { tile: Tile; height: number; breathe: number }) {
  const [state, setState] = useState<'loading' | 'in' | 'failed'>('loading');
  return (
    <div
      className={`au-tile${tile.src ? '' : ` is-stand-in tone-${tile.tone}`}`}
      style={{ height, '--breathe': breathe } as CSSProperties}
    >
      {tile.src ? (
        state !== 'failed' && (
          <img
            // A photo already in the browser's cache may finish before React
            // listens for it.
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0 && state === 'loading') setState('in');
            }}
            src={tile.src}
            alt=""
            decoding="async"
            draggable={false}
            className={state === 'in' ? 'is-in' : ''}
            onLoad={() => setState('in')}
            onError={() => setState('failed')}
          />
        )
      ) : (
        <Icon name={tile.icon!} size={Math.round(height * 0.22)} stroke={1.6} />
      )}
    </div>
  );
}
