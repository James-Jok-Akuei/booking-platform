import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { galleryUploadOptions } from '../business/gallery-upload.options';

/**
 * Multer config for message photo attachments.
 *
 * Deliberately the SAME object as the gallery's (§10.6): 15MB, jpg/png/webp,
 * memory storage, one file. A customer who cannot upload a 20MB photo to a
 * gallery should get the identical refusal when attaching it to a message, and
 * two configs would drift the moment one limit changed.
 */
export const chatUploadOptions: MulterOptions = galleryUploadOptions;
