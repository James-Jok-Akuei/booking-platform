import { Controller, Get, Query } from '@nestjs/common';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { inferOperator } from './operator-routing';

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
export class PaymentsController {
  constructor(private readonly registry: PaymentProviderRegistry) {}

  @Get('providers')
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
