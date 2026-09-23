import { Injectable } from '@nestjs/common';
import { DisbursementProvider } from './disbursement-provider.interface';
import { ProviderRegistry } from './provider-registry';

/**
 * Every operator the platform can PAY OUT through (§64.2).
 *
 * Separate from the collections registry because the two are genuinely
 * independent: MTN issues a different subscription key for Disbursements, and a
 * deployment can easily be able to collect while being unable to pay out —
 * during onboarding that is the NORMAL state, since disbursement needs a
 * merchant agreement that collections does not.
 *
 * A payout resolves its provider from the business's VERIFIED payout
 * destination, never from configuration: that row is what says where the money
 * goes and on which network.
 */
@Injectable()
export class DisbursementProviderRegistry extends ProviderRegistry<DisbursementProvider> {
  constructor(providers: DisbursementProvider[]) {
    super(providers, 'disbursement');
  }

  protected get capability(): string {
    return 'disbursement';
  }
}
