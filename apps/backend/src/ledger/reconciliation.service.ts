import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MomoBalanceProvider } from '../payments/momo-balance.provider';
import { WalletBalance } from '../payments/balance-reporting.interface';
import { LedgerService } from './ledger.service';

/** Why two figures cannot be set against each other. */
export type NotComparableReason =
  | 'SANDBOX'
  | 'DIFFERENT_CURRENCY'
  | 'BALANCE_UNAVAILABLE'
  | 'NOTHING_HELD';

/**
 * Our figure beside the operator's (§87).
 *
 * The point of the pairing is the **difference**, which is the only thing that
 * catches a payment that landed and was never recorded. So the hard part is
 * refusing to show a difference that would be a lie:
 *
 * - **Sandbox** reports a fixed EUR 1000 that no transfer moves. Subtracting
 *   the ledger from it produces a number, and the number means nothing.
 * - **Different currencies** cannot be subtracted at all. The sandbox is EUR
 *   and this deployment settles in RWF.
 * - **No answer** from the operator is not a balance of zero.
 *
 * In each case the figures are still shown — seeing MTN's number is useful on
 * its own — but `comparable` is false and `difference` is null. A screen can
 * then say why instead of printing a confident wrong total.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly balances: MomoBalanceProvider,
  ) {}

  async compare(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can read this.');
    }

    const [held, wallets] = await Promise.all([
      this.ledger.heldTotals(actor),
      this.balances.checkBalances(),
    ]);

    // The collection wallet is the one holding customers' deposits, so that is
    // the figure the ledger is a claim about. The disbursement wallet is what
    // we pay FROM, which is a different question (can we afford the next run)
    // and is reported alongside rather than compared.
    const collection = wallets.find((w) => w.wallet === 'COLLECTION');
    const ours = held.bySettlementCurrency[0] ?? null;

    return {
      asOf: held.asOf,
      isSandbox: this.balances.isSandbox,
      ledger: held.bySettlementCurrency,
      entriesWithoutSettlement: held.entriesWithoutSettlement,
      wallets,
      ...this.judge(ours, collection, this.balances.isSandbox),
    };
  }

  private judge(
    ours: { settlementCurrency: string; amountMinor: number } | null,
    theirs: WalletBalance | undefined,
    isSandbox: boolean,
  ): {
    comparable: boolean;
    difference: number | null;
    notComparableReason: NotComparableReason | null;
    note: string;
  } {
    const no = (reason: NotComparableReason, note: string) => ({
      comparable: false,
      difference: null,
      notComparableReason: reason,
      note,
    });

    if (!theirs || theirs.status !== 'OK') {
      return no(
        'BALANCE_UNAVAILABLE',
        theirs?.status === 'UNAVAILABLE'
          ? `The operator did not report a balance for the wallet that holds deposits. ${theirs.reason}`
          : 'No balance was reported for the wallet that holds deposits. Compare by hand.',
      );
    }

    // Checked BEFORE the currency test on purpose: in sandbox the currencies
    // may happen to match, and the figure would still be meaningless.
    if (isSandbox) {
      return no(
        'SANDBOX',
        `This is MTN's sandbox. Its balances are test figures that real transfers do not move — it reported ${theirs.currency} ${theirs.reportedAmount} — so they cannot be set against the ledger.`,
      );
    }

    if (!ours) {
      return no(
        'NOTHING_HELD',
        'The ledger holds nothing to compare.',
      );
    }

    if (ours.settlementCurrency !== theirs.currency || theirs.amountMinor === null) {
      return no(
        'DIFFERENT_CURRENCY',
        `The ledger is in ${ours.settlementCurrency} and the operator reported ${theirs.currency}. These cannot be subtracted.`,
      );
    }

    const difference = theirs.amountMinor - ours.amountMinor;
    return {
      comparable: true,
      difference,
      notComparableReason: null,
      note:
        difference === 0
          ? 'The operator holds exactly what the ledger says it should.'
          : difference > 0
            ? 'The operator holds MORE than the ledger accounts for. Money may have arrived without being recorded.'
            : 'The operator holds LESS than the ledger accounts for. Money may have left without being recorded.',
    };
  }
}
