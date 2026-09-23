import { IsEnum, IsOptional, Matches } from 'class-validator';
import { MobileMoneyProvider } from '@prisma/client';

export class InitiateDepositPaymentDto {
  /**
   * Payer's number in MSISDN form: digits only, country code first, no plus and
   * no spaces (e.g. "211920100200"). That is the shape MTN expects in
   * `payer.partyId`, and normalising here means the provider never has to guess
   * what a "+211 92 010 0200" was meant to be.
   */
  @Matches(/^\d{8,15}$/, {
    message:
      'phoneNumber must be in MSISDN format: 8-15 digits, country code first, no "+" or spaces.',
  })
  phoneNumber!: string;

  /**
   * Which operator to collect through (§58.1).
   *
   * Optional, and it WINS when supplied. The platform infers the operator from
   * the number's prefix, which is right most of the time and wrong for anyone
   * who has ported their number to another network — and a ported customer has
   * no other way to be paid from. So the inference is a default the caller can
   * always overrule, never a verdict.
   */
  @IsOptional()
  @IsEnum(MobileMoneyProvider)
  provider?: MobileMoneyProvider;
}
