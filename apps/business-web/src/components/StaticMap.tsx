/**
 * A still map around a point, drawn from OpenStreetMap's tiles (§195) — for
 * showing where a branch is, not for finding it. The embedded map (MapPin)
 * stays where a seller places the pin; here the map is a picture, so it has
 * no buttons to be confused by and no frame to load.
 *
 * The tiles are laid out around the point in pixels, so the point lands at
 * `focusX` across the box whatever its width. OpenStreetMap's credit is kept
 * on the picture, as their tile terms require.
 */
const TILE = 256;

/**
 * Where the map pictures come from (§299): OpenStreetMap's own servers unless
 * `VITE_MAP_TILES` names a provider ("https://…/{z}/{x}/{y}.png"). Their own
 * servers are for light use; a busy platform sets a provider before launch,
 * and its credit with `VITE_MAP_CREDIT`. The visitor's browser fetches the
 * pictures, so that server sees its address — said in the privacy policy.
 */
const TILES = (import.meta.env.VITE_MAP_TILES as string | undefined)?.trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CREDIT = (import.meta.env.VITE_MAP_CREDIT as string | undefined)?.trim() || '© OpenStreetMap contributors';
const tileUrl = (z: number, x: number, y: number) =>
  TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

function worldPixel(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const x = ((longitude + 180) / 360) * scale;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function StaticMap({
  latitude,
  longitude,
  zoom = 16,
  focusX = 0.5,
  spanX = 900,
  spanY = 260,
}: {
  latitude: number;
  longitude: number;
  zoom?: number;
  /** Where across the box (0–1) the point sits. */
  focusX?: number;
  /** How far, in pixels, the tiles reach left/right and up/down of the point. */
  spanX?: number;
  spanY?: number;
}) {
  const center = worldPixel(latitude, longitude, zoom);
  const max = 2 ** zoom;
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  const fromX = Math.floor((center.x - spanX) / TILE);
  const toX = Math.floor((center.x + spanX) / TILE);
  const fromY = Math.floor((center.y - spanY) / TILE);
  const toY = Math.floor((center.y + spanY) / TILE);
  for (let ty = fromY; ty <= toY; ty++) {
    if (ty < 0 || ty >= max) continue;
    for (let tx = fromX; tx <= toX; tx++) {
      tiles.push({
        x: ((tx % max) + max) % max,
        y: ty,
        left: tx * TILE - center.x,
        top: ty * TILE - center.y,
      });
    }
  }
  return (
    <div className="static-map">
      {tiles.map((t) => (
        <img
          key={`${t.x}-${t.y}-${t.left}`}
          src={tileUrl(zoom, t.x, t.y)}
          aria-hidden="true"
          alt=""
          loading="lazy"
          draggable={false}
          style={{ left: `calc(${focusX * 100}% + ${t.left}px)`, top: `calc(50% + ${t.top}px)` }}
        />
      ))}
      <span className="static-map-pin" style={{ left: `${focusX * 100}%` }} aria-hidden="true">
        <i />
      </span>
      {/* The credit the map's terms ask for, linking to them. */}
      <a className="static-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        {CREDIT}
      </a>
    </div>
  );
}
