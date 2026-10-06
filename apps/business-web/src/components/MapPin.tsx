/**
 * The pin, on a map, before it is saved (§157).
 *
 * A seller who pastes the wrong link — the city centre, their home — puts
 * every "3 km away" on their branch out by that much, and nothing can tell.
 * The map is the only check that catches it: a pin on a map either looks like
 * your shop or it does not. OpenStreetMap's embed, because it needs no key.
 */
export function MapPin({ latitude, longitude }: { latitude: number; longitude: number }) {
  const d = 0.004;
  const bbox = [longitude - d, latitude - d, longitude + d, latitude + d].join(',');
  return (
    <div className="map-pin">
      <iframe
        title="Where the pin is"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`}
        loading="lazy"
      />
      <a
        className="small"
        href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`}
        target="_blank"
        rel="noreferrer"
      >
        Open a bigger map
      </a>
    </div>
  );
}
