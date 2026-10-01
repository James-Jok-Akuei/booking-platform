import { IsBoolean } from 'class-validator';

/**
 * Turning a service on or off at one branch (§74).
 *
 * Explicit rather than a bare toggle endpoint: a caller that sends what it
 * wants is idempotent, so two taps on a slow connection cannot leave the branch
 * in the state nobody chose.
 */
export class SetServiceOfferedDto {
  @IsBoolean()
  isOffered!: boolean;
}
