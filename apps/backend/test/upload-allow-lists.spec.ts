import { BadRequestException } from '@nestjs/common';
import { galleryUploadOptions } from '../src/business/gallery-upload.options';
import { ticketUploadOptions } from '../src/tickets/ticket-upload.options';
import { chatUploadOptions } from '../src/chat/chat-upload.options';
import { MAX_UPLOAD_BYTES } from '../src/storage/storage.service';

/**
 * §81. Ticket attachments accept more than the gallery does.
 *
 * These two lists diverged deliberately, so the thing worth testing is the
 * divergence itself: a PDF must be accepted on a ticket and refused on a
 * gallery. A single shared object passed both halves of that trivially, which
 * is exactly why the bug survived until someone tried to attach a statement.
 */
type Filter = NonNullable<typeof galleryUploadOptions.fileFilter>;

/** Runs a multer fileFilter and reports what it decided. */
const judge = (filter: Filter, mimetype: string) => {
  let error: Error | null = null;
  let accepted = false;
  filter(
    {} as never,
    { mimetype } as Express.Multer.File,
    ((err: Error | null, ok?: boolean) => {
      error = err;
      accepted = ok ?? false;
    }) as never,
  );
  return { error, accepted };
};

const GALLERY_ONLY = ['image/jpeg', 'image/png', 'image/webp'];

const TICKET_EXTRAS = [
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

describe('Upload allow-lists (§81)', () => {
  describe('ticket attachments', () => {
    it.each([...GALLERY_ONLY, ...TICKET_EXTRAS])('accepts %s', (mimetype) => {
      const { error, accepted } = judge(ticketUploadOptions.fileFilter!, mimetype);
      expect(error).toBeNull();
      expect(accepted).toBe(true);
    });

    it('still refuses an executable', () => {
      const { error, accepted } = judge(
        ticketUploadOptions.fileFilter!,
        'application/x-msdownload',
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(accepted).toBe(false);
    });

    it('names what it does take, so the refusal is actionable', () => {
      const { error } = judge(ticketUploadOptions.fileFilter!, 'application/zip');
      expect((error as unknown as Error).message).toContain('application/zip');
      expect((error as unknown as Error).message).toContain('PDF');
    });
  });

  describe('the gallery did NOT widen with it', () => {
    it.each(TICKET_EXTRAS)('refuses %s — a gallery is a shop window', (mimetype) => {
      const { error, accepted } = judge(galleryUploadOptions.fileFilter!, mimetype);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(accepted).toBe(false);
    });

    it.each(GALLERY_ONLY)('still accepts %s', (mimetype) => {
      const { error, accepted } = judge(galleryUploadOptions.fileFilter!, mimetype);
      expect(error).toBeNull();
      expect(accepted).toBe(true);
    });
  });

  describe('chat kept the gallery rules', () => {
    it('refuses a PDF — only tickets were widened', () => {
      const { accepted } = judge(chatUploadOptions.fileFilter!, 'application/pdf');
      expect(accepted).toBe(false);
    });
  });

  it('shares one size limit across all three', () => {
    for (const options of [galleryUploadOptions, ticketUploadOptions, chatUploadOptions]) {
      expect(options.limits?.fileSize).toBe(MAX_UPLOAD_BYTES);
      expect(options.limits?.files).toBe(1);
    }
  });
});
