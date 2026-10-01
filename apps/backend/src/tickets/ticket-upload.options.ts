import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_EXTENSIONS_LABEL,
  TICKET_MIME_TYPES,
} from '../storage/storage.service';
import { makeUploadOptions } from '../storage/upload-options';

/**
 * Multer config for ticket attachments (§81).
 *
 * ~~Previously the same object as the gallery and chat use (§10.6, §21.6).~~
 * Superseded: that reasoning was "someone refused a 20MB screenshot on a
 * gallery should get the identical refusal attaching it to a ticket", which
 * holds for the *size* limit and not for the *type* list. A gallery is a shop
 * window; a ticket attachment is evidence. Refusing a business's PDF bank
 * statement on a missing-payout ticket was consistency bought at the price of
 * the feature working.
 *
 * The 15MB cap is still shared, and still comes from one constant.
 */
export const ticketUploadOptions: MulterOptions = makeUploadOptions(
  TICKET_MIME_TYPES,
  TICKET_EXTENSIONS_LABEL,
  MAX_TICKET_ATTACHMENTS,
);
