import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_CURRENCY, minorUnitExponent } from './currency';

/**
 * Refuses to start if the internal currency is wrong or has changed (§55.1).
 *
 * `INTERNAL_CURRENCY` is a deployment constant, and every stored amount is
 * denominated in it. Nothing in the database records the unit next to the
 * number — a ledger entry's `amountCents` is a bare integer — so changing the
 * constant does not migrate anything. It silently reinterprets the whole
 * history: a balance of 1,200,000 becomes 1,200,000 of something else.
 *
 * There is no safe way to do that accidentally, so this makes it impossible to
 * do accidentally. Two checks at boot, in the spirit of §52's production
 * assertion — the cost of being wrong is high enough that failing to start is
 * the kind behaviour.
 */
@Injectable()
export class CurrencyGuard implements OnModuleInit {
  private readonly logger = new Logger(CurrencyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // 1. The currency must be one whose minor-unit exponent we actually know.
    //    Throws with the fix in the message.
    const exponent = minorUnitExponent(INTERNAL_CURRENCY);

    // 2. It must match whatever the existing money is already denominated in.
    //    The ledger is the authority: it is append-only and every entry carries
    //    its currency, so a single disagreeing row means the constant moved
    //    under data that was written before it.
    const foreign = await this.prisma.ledgerEntry.findFirst({
      where: { currency: { not: INTERNAL_CURRENCY } },
      select: { currency: true },
      orderBy: { createdAt: 'asc' },
    });

    if (foreign) {
      throw new Error(
        `INTERNAL_CURRENCY is "${INTERNAL_CURRENCY}", but the ledger already ` +
          `holds entries denominated in "${foreign.currency}". Nothing records ` +
          'the unit beside the number, so starting would reinterpret every ' +
          'historical amount rather than convert it. Either set ' +
          `INTERNAL_CURRENCY back to "${foreign.currency}", or migrate the ` +
          'existing entries deliberately.',
      );
    }

    this.logger.log(
      `Internal unit of account: ${INTERNAL_CURRENCY} ` +
        `(${exponent} decimal place${exponent === 1 ? '' : 's'}).`,
    );
  }
}
