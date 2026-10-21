import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { PickedImage } from '../pickImage';
import { font, theme } from '../theme';
import { Icon } from './Icon';

/**
 * Dropping a photo from the computer (§305), on the web app only: onto a
 * conversation to attach it, onto the picture to make it yours. A phone has
 * no dragging, so there this is nothing at all.
 *
 * React Native Web passes no drag events to a View, so they are listened to on
 * its element directly — which, on the web, is what a View's ref is.
 */

/** What the server takes (§81), and what a browser can show. */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 15 * 1024 * 1024;

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function useWebPhotoDrop({
  onPhoto,
  onRefused,
  disabled = false,
}: {
  onPhoto: (photo: PickedImage) => void;
  onRefused: (why: string) => void;
  disabled?: boolean;
}) {
  // A callback ref: the place may appear later (once what it belongs to has
  // loaded), and listening starts when it does.
  const [node, setNode] = useState<View | null>(null);
  const [over, setOver] = useState(false);
  // The latest callbacks, without listening afresh on every render.
  const latest = useRef({ onPhoto, onRefused });
  latest.current = { onPhoto, onRefused };

  useEffect(() => {
    if (Platform.OS !== 'web' || disabled) return;
    const element = node as unknown as HTMLElement | null;
    if (!element?.addEventListener) return;
    let depth = 0;
    // The page guard leaves a marked place alone.
    element.dataset.dropZone = '1';
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setOver(true);
    };
    const hover = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const file = Array.from(event.dataTransfer?.files ?? [])[0];
      if (!file) return;
      if (!PHOTO_TYPES.includes(file.type)) return latest.current.onRefused('That isn’t a photo — use a JPG, PNG or WebP.');
      if (file.size > MAX_BYTES) return latest.current.onRefused('That photo is over 15 MB — try a smaller copy.');
      latest.current.onPhoto({ uri: URL.createObjectURL(file), name: file.name, type: file.type });
    };
    element.addEventListener('dragenter', enter);
    element.addEventListener('dragover', hover);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', drop);
    return () => {
      element.removeEventListener('dragenter', enter);
      element.removeEventListener('dragover', hover);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', drop);
    };
  }, [node, disabled]);

  return { ref: setNode, over };
}

/** Over a drop place: what letting go does. */
export function DropVeil({ label, round = false }: { label: string; round?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.veil, round && styles.round]}>
      <View style={styles.pill}>
        <Icon name="cloud-upload-outline" size={18} color="#FFFFFF" />
        <Text style={styles.text}>{label}</Text>
      </View>
    </View>
  );
}

let guarded = false;
/**
 * A photo let go anywhere else on the page must not replace the app — a
 * browser opens it in place, and whatever was being typed is gone (§305).
 */
export function guardWebDrops() {
  if (Platform.OS !== 'web' || guarded || typeof window === 'undefined') return;
  guarded = true;
  window.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const inZone = event.target instanceof Element && event.target.closest('[data-drop-zone]') !== null;
    if (!inZone && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
}

const styles = StyleSheet.create({
  veil: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: 'rgba(255, 246, 242, 0.9)',
  },
  round: { borderRadius: 999 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: theme.accent,
  },
  text: { fontFamily: font.bold, fontSize: 14, color: '#FFFFFF', textAlign: 'center' },
});
