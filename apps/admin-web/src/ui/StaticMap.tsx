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
    <div className="static-map" aria-hidden="true">
      {tiles.map((t) => (
        <img
          key={`${t.x}-${t.y}-${t.left}`}
          src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`}
          alt=""
          loading="lazy"
          draggable={false}
          style={{ left: `calc(${focusX * 100}% + ${t.left}px)`, top: `calc(50% + ${t.top}px)` }}
        />
      ))}
      <span className="static-map-pin" style={{ left: `${focusX * 100}%` }}>
        <i />
      </span>
      <span className="static-map-credit">© OpenStreetMap contributors</span>
    </div>
  );
}
