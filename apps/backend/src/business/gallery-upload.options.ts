import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  ALLOWED_EXTENSIONS_LABEL,
  ALLOWED_MIME_TYPES,
} from '../storage/storage.service';
import { makeUploadOptions } from '../storage/upload-options';

/**
 * Multer config for gallery uploads: images only.
 *
 * Both checks run before the handler is reached, so an oversized or
 * wrong-typed file never gets as far as the database or the storage driver.
 */
export const galleryUploadOptions: MulterOptions = makeUploadOptions(
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS_LABEL,
);
