import { Matches } from 'class-validator';

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
}
