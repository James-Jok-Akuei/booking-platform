import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppointmentStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../payments/payment-provider.interface';
import { AppointmentsService } from './appointments.service';

/**
 * How long an appointment may sit in PENDING_PAYMENT before it is released.
 *
 * Five minutes is roughly how long a customer plausibly takes to find their
 * phone and approve a prompt, and it bounds how long an unpaid booking can
 * squat on a slot other customers want. Because PENDING_PAYMENT consumes
 * capacity (see the Appointment module), without this a single abandoned
 * checkout would hold a slot indefinitely.
 */
export const PENDING_PAYMENT_TTL_MS = 5 * 60 * 1000;

/**
 * Payment confirmation and expiry.
 *
 * Separate from AppointmentsScheduler (the 24-hour completion sweep) because
 * the cadences and concerns differ by orders of magnitude: this runs every 20
 * seconds and chases live money, that one runs every 15 minutes and tidies up
 * finished appointments.
 *
 * Polling rather than webhooks: MTN supports a callback URL, but sandbox
 * callback delivery is unreliable and a callback endpoint would have to be
 * publicly reachable, which a local dev backend is not. Polling works
 * identically in both environments. See DECISIONS.md.
 */
@Injectable()
export class PaymentsScheduler {
  private readonly logger = new Logger(PaymentsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  /**
   * Asks the provider about every in-flight deposit.
   *
   * Every 20 seconds: fast enough that a customer who approves a prompt sees
   * their booking confirm while they are still looking at the screen, slow
   * enough not to hammer the provider. Only appointments that actually have a
   * reference are polled, so the query is bounded by real in-flight payments
   * rather than by the size of the table.
   */
  @Cron('*/20 * * * * *', { name: 'payment-confirmation-poll' })
  async pollPendingPayments(): Promise<{ confirmed: number; failed: number }> {
    const pending = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.PENDING_PAYMENT,
        paymentProviderReferenceId: { not: null },
      },
      select: { id: true, paymentProviderReferenceId: true },
    });

    if (pending.length === 0) return { confirmed: 0, failed: 0 };

    let confirmed = 0;
    let failed = 0;

    for (const appointment of pending) {
      const reference = appointment.paymentProviderReferenceId!;
      try {
        const result = await this.payments.checkPaymentStatus(reference);
        if (result.status === 'PENDING') continue;

        // Delegated so the poll and the on-demand status read share one
        // implementation of "what a payment outcome does to an appointment".
        await this.appointments.applyPaymentResult(
          appointment.id,
          reference,
          result.status,
          result.failureReason,
        );

        if (result.status === 'SUCCESSFUL') confirmed++;
        else failed++;
      } catch (error) {
        // One provider error must not abort the sweep for every other
        // appointment; the next cycle retries this one.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Payment poll failed for appointment ${appointment.id} (reference ${reference}): ${message}`,
        );
      }
    }

    if (confirmed + failed > 0) {
      this.logger.log(
        `Payment poll: ${pending.length} in flight, ${confirmed} confirmed, ${failed} failed.`,
      );
    }

    return { confirmed, failed };
  }

  /**
   * Cancels appointments that never got their deposit paid, freeing the slot.
   *
   * Because CANCELLED is not a capacity-consuming status, the slot is released
   * the instant this runs — no separate bookkeeping, and the next availability
   * query simply counts one fewer overlapping appointment.
   *
   * One subtlety worth the extra call: an appointment with a payment still in
   * flight gets a FINAL status check before being cancelled. Cancelling
   * something the provider is about to confirm would take the customer's money
   * and give them no appointment, which is the worst outcome this module can
   * produce. If that last check comes back SUCCESSFUL the appointment is booked
   * instead of cancelled.
   */
  @Cron('0 * * * * *', { name: 'pending-payment-expiry' })
  async expirePendingPayments(): Promise<{ cancelled: number; rescued: number }> {
    const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);

    const stale = await this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.PENDING_PAYMENT,
        createdAt: { lt: cutoff },
      },
      select: { id: true, createdAt: true, paymentProviderReferenceId: true },
    });

    if (stale.length === 0) return { cancelled: 0, rescued: 0 };

    let cancelled = 0;
    let rescued = 0;

    for (const appointment of stale) {
      if (appointment.paymentProviderReferenceId) {
        try {
          const result = await this.payments.checkPaymentStatus(
            appointment.paymentProviderReferenceId,
          );
          if (result.status === 'SUCCESSFUL') {
            await this.appointments.applyPaymentResult(
              appointment.id,
              appointment.paymentProviderReferenceId,
              'SUCCESSFUL',
            );
            this.logger.warn(
              `Expiry rescue: appointment ${appointment.id} was past its ${PENDING_PAYMENT_TTL_MS / 60000}-minute window ` +
                'but its deposit had succeeded. Booked instead of cancelled.',
            );
            rescued++;
            continue;
          }
        } catch (error) {
          // If the provider cannot be reached, leave the appointment alone and
          // try again next minute rather than cancelling on incomplete
          // information.
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Expiry check could not reach the provider for appointment ${appointment.id}: ${message}. Leaving it for the next sweep.`,
          );
          continue;
        }
      }

      // Conditional on the status still being PENDING_PAYMENT, so an
      // appointment confirmed by the poll a moment ago is never clobbered.
      const { count } = await this.prisma.appointment.updateMany({
        where: { id: appointment.id, status: AppointmentStatus.PENDING_PAYMENT },
        data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
      });

      if (count > 0) {
        cancelled++;
        // Both sides are told. An expiry is still a cancellation from the
        // customer's point of view, and the business needs to know the slot
        // came back rather than discovering it in a list later.
        await this.appointments.notifyBothParties(
          appointment.id,
          NotificationType.APPOINTMENT_CANCELLED,
          'The deposit was not paid in time, so the booking was released.',
        );
        const ageSeconds = Math.round((Date.now() - appointment.createdAt.getTime()) / 1000);
        this.logger.log(
          `Expired appointment ${appointment.id}: PENDING_PAYMENT for ${ageSeconds}s ` +
            `(limit ${PENDING_PAYMENT_TTL_MS / 1000}s) -> CANCELLED. Capacity released.`,
        );
      }
    }

    if (cancelled + rescued > 0) {
      this.logger.log(
        `Pending-payment expiry: ${cancelled} cancelled, ${rescued} rescued after late confirmation.`,
      );
    }

    return { cancelled, rescued };
  }
}
