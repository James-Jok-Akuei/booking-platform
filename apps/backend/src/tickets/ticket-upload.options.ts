import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { galleryUploadOptions } from '../business/gallery-upload.options';

/**
 * Multer config for ticket attachments.
 *
 * The SAME object the gallery and chat use (§10.6, §21.6): 15MB, jpg/png/webp,
 * memory storage, one file. Someone refused a 20MB screenshot on a gallery
 * should get the identical refusal attaching it to a ticket, and separate
 * configs drift the moment one limit changes.
 */
export const ticketUploadOptions: MulterOptions = galleryUploadOptions;
