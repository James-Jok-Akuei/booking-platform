import { Controller, Get, Query } from '@nestjs/common';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { inferOperator } from './operator-routing';
import { INTERNAL_CURRENCY, minorUnitExponent } from './currency';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  CurrencyDto,
  PaymentProvidersDto,
} from './dto/payment-response.dto';

/**
 * Which mobile money operators this platform can collect through (§58.2).
 *
 * Exists so a client can render the right thing rather than guess: whether to
 * show an operator picker at all, which options it holds, and which one to
 * pre-select for the number the customer just typed.
 *
 * The alternative is every app shipping its own copy of the prefix table, which
 * then has to be updated in several places whenever an operator is added or a
 * prefix range moves. One source, served.
 *
 * Unauthenticated, like the discovery endpoints: which networks a platform
 * accepts is product information a customer needs before they have any reason
 * to have an account, and it says nothing about anybody's money.
 */
@Controller('payments')
@ApiErrors({ validation: true })
export class PaymentsController {
  constructor(private readonly registry: PaymentProviderRegistry) {}

  /**
   * How to render money, so no client has to guess (§70.1).
   *
   * Every amount this API returns is an integer in the MINOR units of
   * `code`, and how many of those make one major unit is a property of the
   * currency — two for dollars, none for francs. A client that hardcodes a
   * division by 100 is correct in one country and wrong by a factor of a
   * hundred in another, which is the §55.2 mistake moved to the front end
   * where it is harder to see.
   *
   * Served unauthenticated, like the operator list: it is a fact about the
   * platform, needed before anyone signs in, and it reveals nothing.
   */
  @Get('currency')
  @ApiOkResponse({ type: CurrencyDto })
  currency() {
    const exponent = minorUnitExponent(INTERNAL_CURRENCY);
    return {
      code: INTERNAL_CURRENCY,
      /** Decimal places. Divide a minor-unit amount by 10^exponent to display it. */
      exponent,
      minorUnitsPerMajor: 10 ** exponent,
      note:
        `Every money amount in this API is an integer number of ${INTERNAL_CURRENCY} ` +
        `minor units. ${exponent === 0 ? 'This currency has no minor unit, so the ' +
        'integer IS the amount.' : `Divide by ${10 ** exponent} to display.`}`,
    };
  }

  @Get('providers')
  @ApiOkResponse({ type: PaymentProvidersDto })
  providers(@Query('phoneNumber') phoneNumber?: string) {
    const available = this.registry.available();

    // Only suggest something the platform can actually act on. Pre-selecting an
    // operator that is not available would put the customer one tap from a 503.
    const inferred = phoneNumber ? inferOperator(phoneNumber) : null;
    const suggested = inferred && available.includes(inferred) ? inferred : null;

    return {
      providers: available,
      /**
       * Our best guess for this number, or null. A GUESS: prefixes follow
       * operators loosely and a ported number keeps its old one, so the client
       * should pre-select this and still let the customer change it (§58.1).
       */
      suggested,
      /** True when the number looks like one we cannot route on its own. */
      choiceRequired: available.length > 1 && suggested === null,
    };
  }
}
