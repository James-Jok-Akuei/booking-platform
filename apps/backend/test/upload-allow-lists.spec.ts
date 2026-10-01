import { BadRequestException } from '@nestjs/common';
import { galleryUploadOptions } from '../src/business/gallery-upload.options';
import { ticketUploadOptions } from '../src/tickets/ticket-upload.options';
import { chatUploadOptions } from '../src/chat/chat-upload.options';
import {
  MAX_TICKET_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
} from '../src/storage/storage.service';
import { MulterExceptionFilter } from '../src/business/filters/multer-exception.filter';

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
    }
  });

  describe('how many files (§83)', () => {
    it('lets a ticket carry several', () => {
      expect(ticketUploadOptions.limits?.files).toBe(MAX_TICKET_ATTACHMENTS);
      expect(MAX_TICKET_ATTACHMENTS).toBeGreaterThan(1);
    });

    it('keeps the gallery and chat at one — a photo replaces a slot', () => {
      expect(galleryUploadOptions.limits?.files).toBe(1);
      expect(chatUploadOptions.limits?.files).toBe(1);
    });
  });
});

/**
 * The filter rewrites multer's unhelpful sentences — and must not touch
 * anything else. Class-validator throws BadRequestException from these same
 * routes, so a filter that rewrote every 400 would replace a list of field
 * errors with a sentence about uploads.
 */
describe('Upload error messages (§83)', () => {
  const run = (filter: MulterExceptionFilter, error: unknown) => {
    let status = 0;
    let body: unknown = null;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    filter.catch(error as never, {
      switchToHttp: () => ({ getResponse: () => res }),
    } as never);
    return { status, body: body as { message: string | string[] } };
  };

  const ticketFilter = new MulterExceptionFilter({
    maxFiles: MAX_TICKET_ATTACHMENTS,
    field: 'attachments',
    noun: 'file',
  });
  const galleryFilter = new MulterExceptionFilter({
    maxFiles: 1,
    field: 'file',
    noun: 'photo',
  });

  it('names the ticket cap and the field', () => {
    const { body } = run(ticketFilter, new BadRequestException('Too many files'));
    expect(body.message).toContain(String(MAX_TICKET_ATTACHMENTS));
    expect(body.message).toContain('attachments');
  });

  it('matches multer sentences that carry the field name', () => {
    const { body } = run(
      ticketFilter,
      new BadRequestException('Unexpected field - attachment'),
    );
    expect(body.message).toContain('attachments');
  });

  it('still tells the gallery to send exactly one photo', () => {
    const { body } = run(galleryFilter, new BadRequestException('Too many files'));
    expect(body.message).toContain('exactly one photo');
  });

  it('passes a validation error through untouched', () => {
    const validation = new BadRequestException({
      message: ['subject must be longer than or equal to 3 characters'],
      error: 'Bad Request',
      statusCode: 400,
    });
    const { status, body } = run(ticketFilter, validation);

    expect(status).toBe(400);
    expect(body.message).toEqual([
      'subject must be longer than or equal to 3 characters',
    ]);
  });
});
