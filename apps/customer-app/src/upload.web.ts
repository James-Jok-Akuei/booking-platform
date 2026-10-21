import { ApiError, requestLanguage, tokens } from './api/client';
import { t } from '@lingui/core/macro';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';

/**
 * Sends a file to the API from a browser (§305) — the web's half of
 * `upload.ts`.
 *
 * Expo's native uploader (`File.upload`) is an empty stand-in on the web, so
 * a profile picture or a photo in a conversation failed there every time.
 * A browser has what a phone lacks: `fetch` with a real `FormData`, which
 * takes the picture as a Blob read back from its `blob:` or `data:` address —
 * where the photo picker, and a photo dropped on the page, leave it.
 *
 * Same answer as the phone's: the server's own sentence when it refuses.
 */
export async function uploadFile<T>(
  path: string,
  file: { uri: string; mimeType: string },
  options?: { fieldName?: string; parameters?: Record<string, string> },
): Promise<T> {
  const blob = await (await fetch(file.uri)).blob();
  const extension = file.mimeType === 'image/png' ? 'png' : file.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const form = new FormData();
  for (const [key, value] of Object.entries(options?.parameters ?? {})) form.append(key, value);
  form.append(options?.fieldName ?? 'file', new Blob([blob], { type: file.mimeType }), `photo.${extension}`);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: form,
    // A refused file is explained in the chosen language (§308).
    headers: {
      'Accept-Language': requestLanguage.current,
      ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    const status = response.status;
    let message = t`Upload failed (${status}).`;
    try {
      const payload = JSON.parse(text) as { message?: string | string[] };
      const raw = payload.message;
      if (raw) message = Array.isArray(raw) ? raw.join(' ') : raw;
    } catch {
      // A non-JSON body means something other than the API answered.
    }
    throw new ApiError(response.status, message);
  }

  return JSON.parse(text) as T;
}
