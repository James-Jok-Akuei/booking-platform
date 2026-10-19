import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * "How was it?" — the customer is asked about a visit once it is done
 * (§287), whether the shop completed it or the day-after sweep did. Opens the
 * review screen for that booking. Never throws: the visit is already done.
 */
export async function askHowItWent(
  prisma: PrismaService,
  notifications: Pick<NotificationsService, 'notify'> | undefined,
  appointmentId: string,
) {
  if (!notifications) return;
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        customerId: true,
        startTime: true,
        service: { select: { name: true } },
        location: { select: { name: true, business: { select: { name: true } } } },
        review: { select: { id: true } },
      },
    });
    // Already reviewed (a review can be written before the shop marks it done).
    if (!appointment || appointment.review) return;
    await notifications.notify({
      recipientId: appointment.customerId,
      type: NotificationType.APPOINTMENT_COMPLETED,
      appointmentId,
      context: {
        serviceName: appointment.service.name,
        locationName: appointment.location.name,
        businessName: appointment.location.business.name ?? appointment.location.name,
        startTime: appointment.startTime,
      },
    });
  } catch {
    // A question about a visit is never worth failing the visit over.
  }
}
