import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  ALLOWED_EXTENSIONS_LABEL,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from '../storage/storage.service';

/**
 * Multer config for gallery uploads.
 *
 * Memory storage, not disk: StorageService decides where the bytes actually
 * land (R2 or the local dev fallback), so multer must not pre-commit them to a
 * temp file. Safe because `limits.fileSize` caps any single request at 15MB
 * before it can be buffered.
 *
 * Both checks run before the handler is reached, so an oversized or wrong-typed
 * file never gets as far as the database or the storage driver.
 */
export const galleryUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as never)) {
      callback(
        new BadRequestException(
          `Unsupported file type "${file.mimetype}". Allowed types: ${ALLOWED_EXTENSIONS_LABEL}.`,
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
