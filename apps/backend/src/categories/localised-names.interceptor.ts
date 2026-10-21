import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { localeOf } from '../i18n/locales';
import { TaxonomyNamesService } from './taxonomy-names.service';

/**
 * Category and type names in the language a request asks for (§308.3) —
 * every answer, so no endpoint has to remember. English answers go straight
 * through; the console asks in English.
 */
@Injectable()
export class LocalisedNamesInterceptor implements NestInterceptor {
  constructor(private readonly names: TaxonomyNamesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | undefined> }>();
    const locale = localeOf(request?.headers?.['accept-language']);
    if (locale === 'en') return next.handle();
    return next.handle().pipe(mergeMap((body) => from(this.names.localise(body, locale))));
  }
}
