import { MobileMoneyProvider, RefundReason, RefundStatus } from '@prisma/client';

export class RefundAppointmentDto {
  id!: string;
  startTime!: string;
  cancelledAt!: string | null;
  serviceName!: string;
  customerEmail!: string;
  branchName!: string;
  businessId!: string;
  businessName!: string;
}

/** A deposit going back to a customer (§313), as our team sees it. */
export class AdminRefundDto {
  id!: string;
  reason!: RefundReason;
  status!: RefundStatus;
  amountMinor!: number;
  currency!: string;
  /** The number it goes to — null on bookings older than §313: find it, send by hand. */
  phoneNumber!: string | null;
  provider!: MobileMoneyProvider | null;
  attempts!: number;
  reference!: string | null;
  failureReason!: string | null;
  sentAt!: string | null;
  doneAt!: string | null;
  createdAt!: string;
  appointment!: RefundAppointmentDto;
}

export class RefundCountsDto {
  PENDING!: number;
  SENDING!: number;
  SENT!: number;
  FAILED!: number;
}

export class AdminRefundPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  counts!: RefundCountsDto;
  refunds!: AdminRefundDto[];
}

export class RefundOutcomeDto {
  id!: string;
  status!: RefundStatus;
  failureReason?: string | null;
}
