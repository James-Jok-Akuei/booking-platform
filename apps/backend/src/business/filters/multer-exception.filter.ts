import {
  ArgumentsHost,
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
 * Replaces the framework's generic upload errors with a message that names the
 * actual limit.
 *
 * `@nestjs/platform-express` intercepts multer's errors first and maps them to
 * HTTP exceptions — LIMIT_FILE_SIZE becomes a PayloadTooLargeException whose
 * body reads only "File too large". That tells a business nothing actionable,
 * so this filter catches the mapped exception (and a raw MulterError, for any
 * code the platform passes straight through) and says what the cap is and what
 * to do about it.
 *
 * The 413 status is kept for the size case — it is the semantically correct
 * code and clients may branch on it; only the message is improved.
 */
@Catch(PayloadTooLargeException, MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: PayloadTooLargeException | MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof PayloadTooLargeException) {
      return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `File is too large. The maximum photo size is ${MAX_MB}MB.`,
        error: 'Payload Too Large',
      });
    }

    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File is too large. The maximum photo size is ${MAX_MB}MB.`
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Upload exactly one file, under the field name "file".'
          : `Upload failed: ${error.message}`;

    return response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }
}
