import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from '../../storage/storage.service';

const MAX_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * The sentences multer uses, which `platform-express` passes through.
 *
 * Prefixes, not exact matches: multer appends the offending field to some of
 * them ("Unexpected field - attachment"), so an equality check silently misses
 * the case and leaves the raw message in place.
 */
const MULTER_SENTENCES = [
  'Too many files',
  'Unexpected field',
  'File too large',
  'Too many parts',
];

const isMulterSentence = (sentence: string) =>
  MULTER_SENTENCES.some((known) => sentence.startsWith(known));

interface UploadLimits {
  /** How many files this endpoint takes. */
  maxFiles: number;
  /** The form field they must arrive under. */
  field: string;
  /** What the endpoint calls them, e.g. "photo" or "file". */
  noun: string;
}

/**
 * Replaces the framework's generic upload errors with a message that names the
 * actual limit.
 *
 * `@nestjs/platform-express` intercepts multer's errors first and maps them to
 * HTTP exceptions — LIMIT_FILE_SIZE becomes a PayloadTooLargeException whose
 * body reads only "File too large", and LIMIT_FILE_COUNT becomes a plain
 * BadRequestException reading "Too many files". Neither says what the cap is.
 *
 * Constructed per endpoint (§83) rather than shared, because the gallery takes
 * one photo under `file` and a ticket takes five files under `attachments`. A
 * single filter could only have been vague or wrong about both.
 *
 * **BadRequestException is caught narrowly.** Class-validator throws the same
 * type from the same routes, so anything that is not one of multer's own
 * sentences is re-emitted byte for byte. Rewriting those would replace a list
 * of field errors with a sentence about uploads.
 */
@Catch(PayloadTooLargeException, MulterError, BadRequestException)
export class MulterExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly limits: UploadLimits = {
      maxFiles: 1,
      field: 'file',
      noun: 'photo',
    },
  ) {}

  private get tooMany(): string {
    return this.limits.maxFiles === 1
      ? `Upload exactly one ${this.limits.noun}, under the field name "${this.limits.field}".`
      : `Too many files. Up to ${this.limits.maxFiles} can be sent at once, under the field name "${this.limits.field}".`;
  }

  private get tooLarge(): string {
    return `File is too large. The maximum ${this.limits.noun} size is ${MAX_MB}MB.`;
  }

  catch(
    error: PayloadTooLargeException | MulterError | BadRequestException,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof PayloadTooLargeException) {
      return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: this.tooLarge,
        error: 'Payload Too Large',
      });
    }

    if (error instanceof BadRequestException) {
      const body = error.getResponse() as { message?: string | string[] };
      const sentence = typeof body?.message === 'string' ? body.message : null;

      // Not multer's — almost certainly class-validator's. Pass it through
      // untouched rather than overwriting a field-level error list.
      if (!sentence || !isMulterSentence(sentence)) {
        return response.status(error.getStatus()).json(body);
      }

      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: sentence.startsWith('File too large') ? this.tooLarge : this.tooMany,
        error: 'Bad Request',
      });
    }

    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? this.tooLarge
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? this.tooMany
          : `Upload failed: ${error.message}`;

    return response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }
}
