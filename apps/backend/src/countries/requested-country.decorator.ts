import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The country a public request asked about (§315): the `X-Country` header,
 * or `?country=` for a link, as an ISO code — or undefined. Only read here;
 * `CountriesService.resolve` turns it into a live country or the default,
 * so an app that sends nothing keeps working exactly as before.
 */
export const RequestedCountry = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; query?: Record<string, unknown> }>();
  const header = request.headers['x-country'];
  const raw = (Array.isArray(header) ? header[0] : header) ?? (typeof request.query?.country === 'string' ? request.query.country : undefined);
  return typeof raw === 'string' && /^[A-Za-z]{2}$/.test(raw.trim()) ? raw.trim().toUpperCase() : undefined;
});
