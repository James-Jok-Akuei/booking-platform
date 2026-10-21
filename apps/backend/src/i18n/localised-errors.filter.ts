import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { localeOf } from './locales';
import { sayError } from './say';

/**
 * Every refusal in the language the request asks for (§308).
 *
 * The apps send `Accept-Language` — the language chosen in them — and the
 * server's own sentence is what they show when something did not work. This
 * changes only the words: the status, the shape and every other field of the
 * answer are exactly what they were (§129), so a client reading `code` or
 * `statusCode` is unaffected, and a request in English goes straight through.
 */
@Catch(HttpException)
export class LocalisedErrorsFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (host.getType() !== 'http') return super.catch(exception, host);
    const request = host.switchToHttp().getRequest<{ headers?: Record<string, string | undefined> }>();
    const locale = localeOf(request?.headers?.['accept-language']);
    if (locale === 'en') return super.catch(exception, host);

    const response = exception.getResponse();
    const said = (message: unknown) => (typeof message === 'string' ? sayError(locale, message) : message);
    let localised: string | object;
    if (typeof response === 'string') {
      localised = said(response) as string;
    } else {
      const body = { ...(response as Record<string, unknown>) };
      if (Array.isArray(body.message)) body.message = body.message.map(said);
      else if (typeof body.message === 'string') body.message = said(body.message);
      localised = body;
    }
    const copy = new HttpException(localised, exception.getStatus(), { cause: exception });
    return super.catch(copy, host);
  }
}
