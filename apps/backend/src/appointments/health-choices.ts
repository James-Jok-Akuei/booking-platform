import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { seal, unseal } from '../common/seal';
import type { ChoicePick } from '../business/service-choices';

/** The word the key is made with, so these can never be opened as anything else. */
const PURPOSE = 'health-choices';

/**
 * A customer's health-related answers (§300.6) — allergies, pregnancy, an
 * injury — sealed before they are stored and opened only for the two people
 * who need them: the customer, and the shop doing the work.
 *
 * Kept in their own column, apart from the booking's other choices, which
 * go everywhere the booking goes. These never go into an email, a phone
 * alert or a calendar invite, and are removed 30 days after the visit.
 */
@Injectable()
export class HealthChoices {
  private readonly logger = new Logger(HealthChoices.name);

  constructor(private readonly config: ConfigService) {}

  /** Null when there is nothing to keep. */
  seal(picks: readonly ChoicePick[]): string | null {
    if (picks.length === 0) return null;
    return seal(JSON.stringify(picks), this.key(), PURPOSE);
  }

  /**
   * The answers, or null when there were none. When they cannot be read —
   * the key was changed — an empty list rather than a failed page: the shop
   * then asks at the visit, which is what it would do without them.
   */
  open(sealed: string | null): ChoicePick[] | null {
    if (!sealed) return null;
    try {
      return JSON.parse(unseal(sealed, this.key(), PURPOSE)) as ChoicePick[];
    } catch {
      this.logger.error('Health-related answers on a booking could not be opened (has the key changed?).');
      return [];
    }
  }

  private key(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? '';
  }
}
