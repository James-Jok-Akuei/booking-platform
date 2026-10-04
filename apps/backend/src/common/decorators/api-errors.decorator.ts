import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiErrorDto,
  UnauthorizedErrorDto,
  ValidationErrorDto,
} from '../dto/api-error.dto';

/**
 * The failures a controller's routes can actually produce (§129.2).
 *
 * Applied to the CONTROLLER CLASS, not to each route: Swagger propagates a
 * class-level response to every operation in it, so one line covers a whole
 * module and cannot drift route by route. Writing these per handler would mean
 * roughly six hundred decorators, which is six hundred chances to forget one.
 *
 * Every flag is opt-IN. A 404 on a route that takes no id, or a 403 on one with
 * no role guard, is a documented failure that cannot happen — and a contract
 * that over-promises errors is as misleading as one that under-promises them.
 */
export function ApiErrors(
  options: {
    /** Behind JwtAuthGuard: 401 when the token is missing or expired. */
    auth?: boolean;
    /** Behind RolesGuard or BusinessRolesGuard: 403 for the wrong role. */
    roles?: boolean;
    /** Takes a body or a typed path parameter: 400 with one message per rule. */
    validation?: boolean;
    /**
     * Takes an id. 404 covers BOTH "no such row" and "not yours" — the §27.2
     * rule: a cross-tenant read is a 404, never a 403, so an id cannot be
     * confirmed to exist by probing it.
     */
    notFound?: boolean;
    /** 409 where a second attempt at the same act is refused. */
    conflict?: boolean;
    /** Under a narrower rate limit than the global one. */
    rateLimited?: boolean;
  } = {},
) {
  const decorators = [];

  if (options.auth) {
    decorators.push(
      ApiUnauthorizedResponse({
        type: UnauthorizedErrorDto,
        description:
          'No token, an expired one, or one for an account that has since been ' +
          'closed. Carries no `error` field.',
      }),
    );
  }

  if (options.roles) {
    decorators.push(
      ApiForbiddenResponse({
        type: ApiErrorDto,
        description:
          'Signed in, but not as someone this route is for. Never returned for ' +
          "another tenant's data — that is a 404 (§27.2).",
      }),
    );
  }

  if (options.validation) {
    decorators.push(
      ApiBadRequestResponse({
        type: ValidationErrorDto,
        description:
          'The body or a path parameter broke a rule. `message` is an ARRAY, ' +
          'one entry per broken rule. Also returned for a malformed UUID, and ' +
          'for a domain rule refused with a single sentence.',
      }),
    );
  }

  if (options.notFound) {
    decorators.push(
      ApiNotFoundResponse({
        type: ApiErrorDto,
        description:
          'No such row — OR it belongs to somebody else. The two are ' +
          'deliberately indistinguishable (§27.2).',
      }),
    );
  }

  if (options.conflict) {
    decorators.push(
      ApiConflictResponse({
        type: ApiErrorDto,
        description:
          'The act has already happened, or something else holds the slot it ' +
          'needs. Safe to show the message and stop.',
      }),
    );
  }

  if (options.rateLimited) {
    decorators.push(
      ApiTooManyRequestsResponse({
        type: ApiErrorDto,
        description:
          'Under a narrower limit than the platform-wide one. The message says ' +
          'how long to wait.',
      }),
    );
  }

  return applyDecorators(...decorators);
}
