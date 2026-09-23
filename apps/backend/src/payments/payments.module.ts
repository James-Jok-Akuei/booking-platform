import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrencyGuard } from './currency-guard.service';
import { MomoPaymentProvider } from './momo-payment.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';

/**
 * Wires the configured PaymentProvider.
 *
 * The swap point is this factory and nothing else: adding NilPay means writing
 * a class that implements PaymentProvider and adding one case here. Everything
 * downstream injects the PAYMENT_PROVIDER token and never names a provider.
 *
 * Global because both AppointmentsService and the payment-polling job need it.
 */
@Global()
@Module({
  providers: [
    CurrencyGuard,
    MomoPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, MomoPaymentProvider],
      useFactory: (config: ConfigService, momo: MomoPaymentProvider): PaymentProvider => {
        const configured = (config.get<string>('PAYMENT_PROVIDER') ?? 'momo').trim().toLowerCase();

        switch (configured) {
          case 'momo':
            return momo;
          default:
            // Fail loud but keep booting: an unknown provider name is a config
            // typo, and every payment attempt failing with a clear message is
            // more debuggable than the whole API refusing to start.
            new Logger('PaymentsModule').error(
              `Unknown PAYMENT_PROVIDER "${configured}". Falling back to "momo". Valid values: momo.`,
            );
            return momo;
        }
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
