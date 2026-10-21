import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { localeOf, type Locale } from './locales';

/**
 * The language a request asks to be answered in (§308) — what the app sends
 * as `Accept-Language`, English when it says nothing we speak.
 */
export const RequestLocale = createParamDecorator((_: unknown, context: ExecutionContext): Locale => {
  const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | undefined> }>();
  return localeOf(request?.headers?.['accept-language']);
});
