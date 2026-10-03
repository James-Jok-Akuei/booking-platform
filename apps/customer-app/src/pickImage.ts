import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

/**
 * Picks a photo and hands back something the server will actually accept (§125).
 *
 * The re-encode is the whole point and it is not optional. An iPhone's library
 * returns **HEIC**, which the upload allow-list refuses — jpg, png and webp only
 * (§81) — so "Add a picture" failed on every iPhone with a 400 the screen turned
 * into "Could not add that". The picker also reports `mimeType` as optional, and
 * React Native sends `application/octet-stream` when it does not know, which the
 * same allow-list refuses for the same reason.
 *
 * Widening the server to accept HEIC would have been the smaller change and the
 * wrong one: a HEIC profile picture renders in neither web app, because browsers
 * do not support it. §88 wanted shop-window images that display everywhere, and
 * a picture nobody can see is not a picture. So the phone — the only place that
 * can read HEIC — is where it is converted.
 *
 * JPEG rather than PNG: a photograph is what this is for, and a PNG of one is
 * several times the bytes over a connection that is often somebody's data.
 */
export async function pickImage(options?: {
  square?: boolean;
}): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Allow photo access in Settings to add a picture. You can still use ' +
        'everything else.',
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: options?.square ?? false,
    ...(options?.square ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return null;

  // Re-encoded here rather than trusted: whatever came out of the library, what
  // leaves this function is a JPEG and says so.
  const rendered = await ImageManipulator.manipulate(result.assets[0].uri).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

  return { uri: saved.uri, name: 'photo.jpg', type: 'image/jpeg' };
}
