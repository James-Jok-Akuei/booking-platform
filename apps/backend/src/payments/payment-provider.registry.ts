import { Injectable } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { ProviderRegistry } from './provider-registry';

/**
 * Every operator the platform can COLLECT through (§57.1).
 *
 * ## The part that is not optional
 *
 * A provider reference means something only to the operator that issued it.
 * `checkPaymentStatus` asking the wrong operator gets "no such transaction",
 * which is indistinguishable from a genuine failure — so the poller would mark
 * paid bookings as failed and cancel them. Every caller therefore resolves the
 * provider from the appointment's own `paymentProvider` column rather than from
 * configuration.
 */
@Injectable()
export class PaymentProviderRegistry extends ProviderRegistry<PaymentProvider> {
  constructor(providers: PaymentProvider[]) {
    super(providers, 'payment');
  }

  protected get capability(): string {
    return 'payment';
  }
}
