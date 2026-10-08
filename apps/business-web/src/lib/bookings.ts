import { listAppointments, type Appointment, type AppointmentStatus } from '../api/business';

/** Statuses that are a customer actually coming — the ones a busy day is made of. */
export const REAL_STATUSES: AppointmentStatus[] = ['BOOKED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

/** Every booking between two instants, a hundred at a time (the list's page size), up to a thousand. */
export async function bookingsBetween(from: Date, to: Date) {
  const rows: Appointment[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await listAppointments({
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 100,
      offset,
    });
    rows.push(...page.appointments);
    if (rows.length >= page.total || page.appointments.length < 100) break;
  }
  return rows;
}
