import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MAX_UPLOAD_BYTES } from './storage.service';

/**
 * Builds multer options for one allow-list.
 *
 * Memory storage, not disk: StorageService decides where the bytes actually
 * land (R2 or the local dev fallback), so multer must not pre-commit them to a
 * temp file. Safe because `limits.fileSize` caps any single request at 15MB
 * before it can be buffered.
 *
 * A factory rather than one shared object, because §81 gave tickets a wider
 * list than the gallery and §83 gave them more than one file. The *filter* is
 * still written once — only the allow-list and the count differ.
 */
export const makeUploadOptions = (
  allowed: readonly string[],
  label: string,
  maxFiles = 1,
): MulterOptions => ({
  limits: { fileSize: MAX_UPLOAD_BYTES, files: maxFiles },
  fileFilter: (_req, file, callback) => {
    if (!allowed.includes(file.mimetype)) {
      callback(
        new BadRequestException(
          `Unsupported file type "${file.mimetype}". Allowed types: ${label}.`,
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
});
