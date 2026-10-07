import { Image, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { font, theme } from '../theme';
import { Cover } from '../ui/Cover';
import type { ViewerOrigin, ViewerPhoto } from '../ui/PhotoViewer';
import { PressableScale } from '../ui/PressableScale';

const GAP = 4;

/**
 * The photos of a service, several at once (§181): one large, and beside it
 * up to four small ones in a grid — the arrangement the user asked for, so a
 * buyer sees what there is without swiping. A fifth small tile says "+N" when
 * there are more; every tile opens the viewer at that photo (§135.7).
 *
 * With two to four photos the grid simply has fewer tiles — two stacked, or
 * two over one — never an empty cell. With one, it fills the width. With
 * none, the shop's own picture, then the category's tile.
 */
export function PhotoMosaic({
  photos,
  fallbackUri,
  categoryIcon,
  width,
  wide,
  onOpen,
}: {
  photos: ViewerPhoto[];
  fallbackUri?: string | null;
  categoryIcon?: string | null;
  width: number;
  /** A tablet: the large photo takes half, as in the design it follows. */
  wide?: boolean;
  onOpen: (index: number, origin: ViewerOrigin | null) => void;
}) {
  const height = wide
    ? Math.round(width * 0.38)
    : Math.max(170, Math.min(260, Math.round(width * 0.56)));

  if (photos.length === 0) {
    return (
      <Cover
        uri={fallbackUri}
        categoryIcon={categoryIcon}
        style={{ width, height, borderRadius: 14 }}
        iconSize={56}
      />
    );
  }

  const smalls = photos.slice(1, 5);
  const extra = photos.length - 5;

  if (smalls.length === 0) {
    return <Tile photo={photos[0]} index={0} width={width} height={height} radius={14} onOpen={onOpen} />;
  }

  const bigWidth = Math.round((width - GAP) * (wide ? 0.5 : 0.6));
  const gridWidth = width - GAP - bigWidth;
  // Two stacked when there are two; otherwise rows of two, the last row
  // holding whatever is left and stretching to fill.
  const rows = (
    smalls.length === 2 ? [[smalls[0]], [smalls[1]]] : [smalls.slice(0, 2), smalls.slice(2)]
  ).filter((row) => row.length > 0);
  // Every tile is given its exact size: the press wrapper draws its style on
  // an inner view, so `flex` on a tile would size the inside and not the tile.
  const rowHeight = (height - GAP * (rows.length - 1)) / rows.length;

  return (
    <View style={{ width, height, flexDirection: 'row', gap: GAP }}>
      <Tile photo={photos[0]} index={0} width={bigWidth} height={height} radius={14} onOpen={onOpen} />
      <View style={{ width: gridWidth, height, gap: GAP }}>
        {rows.map((row, r) => {
          const tileWidth = (gridWidth - GAP * (row.length - 1)) / row.length;
          return (
            <View key={r} style={styles.row}>
              {row.map((photo) => {
                const index = photos.indexOf(photo);
                return (
                  <Tile
                    key={photo.id}
                    photo={photo}
                    index={index}
                    width={tileWidth}
                    height={rowHeight}
                    radius={10}
                    more={index === 4 && extra > 0 ? extra : 0}
                    onOpen={onOpen}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Tile({
  photo,
  index,
  width,
  height,
  radius,
  more = 0,
  onOpen,
}: {
  photo: ViewerPhoto;
  index: number;
  width: number;
  height: number;
  radius: number;
  /** How many photos are not shown, said on the last tile. */
  more?: number;
  onOpen: (index: number, origin: ViewerOrigin | null) => void;
}) {
  const open = (event: GestureResponderEvent) => {
    // Asked of the tile itself rather than worked out from the touch: the
    // touch's own offsets are not reported the same way everywhere, and a
    // wrong origin is worse than none.
    const target = event.currentTarget as unknown as {
      measureInWindow?: (done: (x: number, y: number, w: number, h: number) => void) => void;
    };
    if (!target?.measureInWindow) return onOpen(index, null);
    target.measureInWindow((x, y, w, h) =>
      onOpen(index, [x, y, w, h].every(Number.isFinite) ? { x, y, width: w, height: h } : null),
    );
  };

  return (
    <PressableScale
      scaleTo={0.97}
      accessibilityRole="imagebutton"
      accessibilityLabel={more > 0 ? `Photo ${index + 1}, and ${more} more` : `Photo ${index + 1}`}
      onPress={open}
      style={[styles.tile, { width, height, borderRadius: radius }]}
    >
      <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {more > 0 && (
        <View style={styles.more}>
          <Text style={styles.moreText}>+{more}</Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  tile: { overflow: 'hidden', backgroundColor: theme.line },
  more: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,12,18,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { fontFamily: font.extrabold, fontSize: 18, color: '#FFFFFF' },
});
