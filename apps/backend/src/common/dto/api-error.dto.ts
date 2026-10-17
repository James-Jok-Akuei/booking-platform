import { ApiProperty } from '@nestjs/swagger';

/**
 * What a failure actually looks like (§129.1).
 *
 * VERIFIED against the booted application, not read off Nest's documentation —
 * and the shape is NOT uniform, which is the whole reason this file exists:
 *
 *   401  { statusCode, message }                  — NO `error` field
 *   403  { statusCode, message, error }
 *   404  { statusCode, message, error }
 *   400  { statusCode, message: string[], error } — an ARRAY, one per rule
 *   409  { statusCode, message, error }
 *
 * So `error` is optional and `message` is `string | string[]`. A client that
 * reads `error` on a 401, or renders `message` as a string on a 400, is wrong
 * in a way nothing was telling it about.
 *
 * There is no global exception filter: this is Nest's own serialisation of
 * `HttpException`, which is why the 401 differs — `UnauthorizedException` is
 * thrown by the guard with no description, and Nest omits `error` when the
 * description equals the status text.
 */
export class ApiErrorDto {
  statusCode!: number;

  /**
   * Written to be SHOWN. Domain failures are sentences — "Appointment not
   * found.", "This adjustment has already been executed." — because the person
   * who hit them needs to know what to do next, not a code to look up.
   */
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'A sentence for a domain failure; an ARRAY of sentences for a validation ' +
      'failure, one per broken rule.',
  })
  message!: string | string[];

  /**
   * The status text, e.g. "Not Found". ABSENT on a 401 — see above.
   */
  @ApiProperty({ required: false, example: 'Not Found' })
  error?: string;

  /**
   * A machine-readable reason, on the few refusals a client answers by doing
   * something rather than by showing the sentence: `STEP_UP_REQUIRED` means
   * "ask for a code, then send the same request again" (§279).
   */
  @ApiProperty({ required: false, example: 'STEP_UP_REQUIRED' })
  code?: string;
}

/**
 * A validation failure, where `message` is always an array.
 *
 * Its own schema because this is the one error a client is expected to RENDER
 * field by field, and typing it as `string | string[]` there means every form
 * does the same narrowing by hand.
 */
export class ValidationErrorDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  /** One entry per broken rule. A single field can produce several. */
  @ApiProperty({
    type: [String],
    example: ['email must be an email', 'property nope should not exist'],
  })
  message!: string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}

/**
 * Specifically a 401, which carries NO `error` field.
 *
 * Separate so the contract stops promising a field this response has never
 * sent — the §128.31 mistake, in the one place nobody had looked.
 */
export class UnauthorizedErrorDto {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({ example: 'Unauthorized' })
  message!: string;
}
