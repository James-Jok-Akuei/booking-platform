import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { LOCALES, type Locale } from '../../i18n/locales';

/** The language chosen in an app (§308), for everything sent to this person. */
export class SetLocaleDto {
  @ApiProperty({ enum: LOCALES })
  @IsIn(LOCALES, { message: `locale must be one of ${LOCALES.join(', ')}.` })
  locale!: Locale;
}
