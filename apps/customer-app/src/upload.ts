import { File } from 'expo-file-system';
import { UploadType } from 'expo-file-system';
import { ApiError, tokens } from './api/client';
import { t } from '@lingui/core/macro';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';

/**
 * Sends a file to the API (§125.2).
 *
 * **Not through `fetch` and not through `FormData`, and that is the fix.** Expo
 * installs a WinterCG `fetch` whose FormData conversion handles only strings and
 * Blobs — a React Native `{ uri, name, type }` part falls through its `entries()`
 * patch as `undefined` and lands on:
 *
 *     Error: Unsupported FormDataPart implementation
 *
 * which is what every upload from the phone returned. The `{ uri }` shape is
 * React Native's own convention and `ExpoFormData` even declares an overload for
 * it; the converter simply does not implement that branch.
 *
 * `File.upload` is Expo's own multipart uploader. It builds the request
 * natively, so there is no FormData to convert and nothing to fall through.
 *
 * The token is attached by hand because this does not go through `api()`. A
 * 401 here is not retried: these are one-shot uploads a person is watching, and
 * the next screen they touch will refresh the session anyway.
 */
export async function uploadFile<T>(
  path: string,
  file: { uri: string; mimeType: string },
  options?: { fieldName?: string; parameters?: Record<string, string> },
): Promise<T> {
  const result = await new File(file.uri).upload(`${BASE_URL}${path}`, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: options?.fieldName ?? 'file',
    mimeType: file.mimeType,
    ...(options?.parameters ? { parameters: options.parameters } : {}),
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });

  if (result.status >= 400) {
    // The server's own sentence, which says what was wrong with the file — not
    // "upload failed", which §125 spent an evening failing to explain.
    const status = result.status;
    let message = t`Upload failed (${status}).`;
    try {
      const payload = JSON.parse(result.body) as { message?: string | string[] };
      const raw = payload.message;
      if (raw) message = Array.isArray(raw) ? raw.join(' ') : raw;
    } catch {
      // A non-JSON body means something other than the API answered.
    }
    throw new ApiError(result.status, message);
  }

  return JSON.parse(result.body) as T;
}
