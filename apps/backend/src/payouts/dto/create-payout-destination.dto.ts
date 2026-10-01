import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { MobileMoneyProvider } from '@prisma/client';
import { E164 } from '../msisdn';

export class CreatePayoutDestinationDto {
  /**
   * The mobile-money number payouts are sent to, in E.164.
   *
   * The SHAPE is checked here; the expected country prefix is checked in the
   * service, because it is configurable (§48.2).
   */
  @IsString()
  @Matches(E164, {
    message:
      'msisdn must be in E.164 format — a leading +, a country code, then the ' +
      'national number, e.g. +250788123456.',
  })
  msisdn!: string;

  @IsOptional()
  @IsEnum(MobileMoneyProvider)
  provider?: MobileMoneyProvider;
}
