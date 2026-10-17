import { Length } from 'class-validator';

/** The six digits from the "confirm it is you" email (§279). */
export class StepUpCodeDto {
  @Length(6, 6)
  code!: string;
}
