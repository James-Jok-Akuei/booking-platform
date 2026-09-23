import { Global, Module } from '@nestjs/common';
import { CurrencyGuard } from './currency-guard.service';
import { MomoPaymentProvider } from './momo-payment.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentsController } from './payments.controller';

/**
 * Wires every payment provider the platform can talk to (§57.1).
 *
 * Adding an operator means writing a class implementing PaymentProvider and
 * listing it in the factory below. Nothing downstream names a provider: callers
 * ask the registry for the one a given appointment was paid through.
 *
 * ## What changed, and why the old shape could not stay
 *
 * This used to read `PAYMENT_PROVIDER` from the environment and return a single
 * instance, so the operator was chosen once at boot. That works for one
 * operator per country and breaks for two: which operator a customer pays with
 * is a property of their SIM, not of the deployment. It also left the payment
 * poller unable to tell which operator issued a reference, which is not a
 * cosmetic problem — see PaymentProviderRegistry.
 *
 * `PAYMENT_PROVIDER` is no longer read. A provider is available when its own
 * credentials are configured, which is a fact rather than a setting, and one
 * fewer thing to get wrong in two places.
 *
 * Global because AppointmentsService and the payment-polling job both need it.
 */
@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    CurrencyGuard,
    MomoPaymentProvider,
    {
      provide: PaymentProviderRegistry,
      inject: [MomoPaymentProvider],
      useFactory: (momo: MomoPaymentProvider) => new PaymentProviderRegistry([momo]),
    },
  ],
  exports: [PaymentProviderRegistry],
})
export class PaymentsModule {}
