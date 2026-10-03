import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { MobileMoneyProvider } from '@prisma/client';

export class SaveNumberDto {
  /**
   * The same rule the payment endpoint applies (§109.2) — digits only, 8 to 15.
   * Checked here as well so a number cannot be SAVED in a shape that would then
   * be refused at the moment somebody tried to pay with it.
   */
  @Matches(/^\d{8,15}$/, {
    message: 'phoneNumber must be 8-15 digits, with no spaces or "+".',
  })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  label?: string;

  @IsOptional()
  @IsEnum(MobileMoneyProvider)
  provider?: MobileMoneyProvider;
}
