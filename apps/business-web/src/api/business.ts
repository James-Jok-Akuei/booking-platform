import { api } from './client';

/**
 * The business endpoints this app uses.
 *
 * Hand-written over the generated contract, like the admin console: the
 * contract owns the shapes, this file records which of the backend's endpoints
 * this app actually touches.
 */

export type AppointmentStatus =
  | 'PENDING_PAYMENT'
  | 'BOOKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Appointment {
  id: string;
  status: AppointmentStatus;
  startTime: string;
  endTime: string;
  /** Minor units of `currency`. Never divided here; see `Currency` below. */
  depositAmountMinor: number;
  platformFeeAmountMinor: number;
  businessAmountMinor: number;
  servicePriceMinor: number | null;
  currency: string;
  depositPaidAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  verificationCodeSentAt: string | null;
  service: { id: string; name: string; durationMinutes: number };
  customer: { id: string; email: string };
  location: { id: string; name: string; address: string; businessId: string };
}

export interface AppointmentPage {
  total: number;
  limit: number;
  offset: number;
  appointments: Appointment[];
}

export interface Me {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  businessMembership: {
    id: string;
    role: 'OWNER' | 'MANAGER' | 'STAFF';
    status: string;
    businessProfile: { id: string; name: string | null; status: string };
  } | null;
}

/**
 * How to render money (§70.1).
 *
 * Fetched, never assumed. Dividing by 100 is correct in a two-decimal currency
 * and wrong by a factor of a hundred in a currency with no minor unit — the
 * §55.2 mistake, moved to the front end where it is harder to see.
 */
export interface Currency {
  code: string;
  exponent: number;
  minorUnitsPerMajor: number;
  note: string;
}

export const getMe = () => api<Me>('/users/me');

export const getCurrency = () => api<Currency>('/payments/currency', { anonymous: true });

export const listAppointments = (params: {
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) => api<AppointmentPage>('/appointments', { query: params });

/** The code the customer reads out. Moves BOOKED -> IN_PROGRESS (§16.2). */
export const verifyArrival = (id: string, code: string) =>
  api<Appointment>(`/business/appointments/${id}/verify`, {
    method: 'POST',
    body: { code },
  });

/**
 * Verification without the code — OWNER and MANAGER only (§54.3).
 *
 * Recorded against whoever does it, with what the customer recalled, and every
 * admin is told. The note is not checked against the appointment: every fact a
 * server could check is already on this screen.
 */
export const verifyManually = (id: string, note: string) =>
  api<Appointment>(`/business/appointments/${id}/verify-manually`, {
    method: 'POST',
    body: { note },
  });

export const completeAppointment = (id: string) =>
  api<Appointment>(`/business/appointments/${id}/complete`, { method: 'POST' });

export const markNoShow = (id: string) =>
  api<Appointment>(`/business/appointments/${id}/no-show`, { method: 'POST' });

/**
 * A business cancelling a PAID appointment refunds the customer in full,
 * including the platform's own fee (§36) — so the server requires a reason and,
 * where a deposit was taken, what the gateway charged.
 */
export const cancelAppointment = (id: string, reason: string) =>
  api<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: { reason } });

// ---------------------------------------------------------------------------
// Profile, services, locations (§10)
// ---------------------------------------------------------------------------

export interface BusinessProfile {
  id: string;
  name: string | null;
  description: string | null;
  phone: string | null;
  /** The shop window. Uploaded, not linked — see `setProfileImage` (§88). */
  logoUrl: string | null;
  coverImageUrl: string | null;
  status: string;
  statusReason: string | null;
  /**
   * Set while the business has paused itself (§119.3). Distinct from `status`:
   * that is what an admin decided, this is what the business decided.
   */
  pausedAt: string | null;
  category: { id: string; name: string; icon: string | null } | null;
  subcategory: { id: string; name: string } | null;
}

/** Where a service is offered, and what it costs there (§72). */
export interface ServiceOffer {
  locationId: string;
  /** Minor units. Format with the server's exponent, never /100. */
  priceMinor: number;
  /** False means paused here — the price is kept, ready to resume (§74). */
  isOffered: boolean;
  location: { id: string; name: string };
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  currency: string;
  /** A decimal string, e.g. "20" — percent of the price taken up front. */
  depositPercentage: string;
  isActive: boolean;
  /**
   * The branches that sell this, with each branch's price.
   *
   * Empty means offered nowhere: still in the catalogue, bookable by nobody.
   */
  locations: ServiceOffer[];
}

export interface Hours {
  id: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  capacity: number;
  ratingAvg: string | null;
  ratingCount: number;
  fromPriceMinor: number | null;
  /** False means the branch is closed: no bookings, invisible to customers (§89). */
  isActive: boolean;
  /** Null until someone says where it is. Not findable by place until then. */
  district: { id: string; name: string; province: { id: string; name: string } } | null;
  hours: Hours[];
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  subcategories: Array<{ id: string; name: string }>;
}

export const getProfile = () => api<BusinessProfile>('/business/profile');

export const updateProfile = (body: {
  name?: string;
  description?: string;
  phone?: string;
  categoryId?: string;
  subcategoryId?: string;
}) => api<BusinessProfile>('/business/profile', { method: 'PATCH', body });

export const getCategories = () => api<Category[]>('/categories', { anonymous: true });

export const listServices = () => api<Service[]>('/business/services');

/**
 * `depositPercentage` must be at least the platform fee (§40) — the server
 * refuses otherwise, naming the figure, because a smaller deposit would price
 * the business's own share below zero.
 */
export const createService = (body: {
  name: string;
  description?: string;
  durationMinutes: number;
  depositPercentage: number;
  offers: Array<{ locationId: string; priceMinor: number }>;
}) => api<Service>('/business/services', { method: 'POST', body });

export const updateService = (
  id: string,
  body: Partial<{
    name: string;
    description: string;
    durationMinutes: number;
    depositPercentage: number;
    isActive: boolean;
    /** REPLACES the branch list wholesale, like the week of hours. */
    offers: Array<{ locationId: string; priceMinor: number }>;
  }>,
) => api<Service>(`/business/services/${id}`, { method: 'PATCH', body });

/**
 * Turns a service on or off at ONE branch (§74).
 *
 * A toggle: the price is kept while paused, so resuming costs one tap rather
 * than retyping what the work costs.
 */
export const setServiceOfferedAt = (
  id: string,
  locationId: string,
  isOffered: boolean,
) =>
  api<{
    message: string;
    isOffered: boolean;
    offeredAtCount: number;
    service: Service;
  }>(`/business/services/${id}/locations/${locationId}`, {
    method: 'PATCH',
    body: { isOffered },
  });

/** Retires everywhere. Past appointments still resolve to what was booked. */
export const retireService = (id: string) =>
  api<void>(`/business/services/${id}`, { method: 'DELETE' });

export const listLocations = () => api<Location[]>('/business/locations');

export const setHours = (
  locationId: string,
  hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed?: boolean }>,
) =>
  api<Hours[]>(`/business/locations/${locationId}/hours`, {
    method: 'POST',
    body: { hours },
  });

export const setCapacity = (locationId: string, capacity: number) =>
  api<Location>(`/business/locations/${locationId}/capacity`, {
    method: 'PATCH',
    body: { capacity },
  });

/**
 * Turns a service on or off at EVERY branch (§76).
 *
 * "Everywhere" acts on the branches, not on the service's own retired flag —
 * flipping that instead left a service off sale while every branch still
 * claimed to be selling it.
 */
export const setServiceOfferedEverywhere = (id: string, isOffered: boolean) =>
  api<{
    message: string;
    isOffered: boolean;
    offeredAtCount: number;
    service: Service;
  }>(`/business/services/${id}/offered`, { method: 'PATCH', body: { isOffered } });

// ---------------------------------------------------------------------------
// Getting paid (§48, §35)
// ---------------------------------------------------------------------------

export type PayoutDestinationStatus =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUPERSEDED';

export interface PayoutDestination {
  id: string;
  provider: 'MTN_MOMO' | 'AIRTEL_MONEY';
  status: PayoutDestinationStatus;
  submittedAt: string;
  verifiedAt: string | null;
  verificationMethod: 'ADMIN' | 'OTP' | null;
  rejectionReason: string | null;
  /** Masked for everyone; the full number only for the OWNER who submitted it. */
  msisdnLast3: string;
  msisdn?: string;
}

export interface Balance {
  payoutsPaused: boolean;
  /** Which of the two reasons a run would skip this business (§77). */
  payoutsPausedReason: 'BUSINESS_SUSPENDED' | 'DESTINATION_NOT_VERIFIED' | null;
  currency: string;
  availableBySettlementCurrency: Array<{ currency: string; amountMinor: number }>;
  /** Matured and ready for the next run. */
  availableNowMinor: number;
  /** Earned, still inside the hold period. */
  pendingMinor: number;
  /** Appointments with no outcome yet — not yours until they resolve. */
  unresolvedMinor: number;
  lifetimePaidMinor: number;
  payoutCount: number;
  pendingPayouts: { count: number; reportingInternalMinor: number };
  note: string;
}

export interface Payout {
  id: string;
  settlementCurrency: string;
  settlementAmountMinor: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  reference: string | null;
  failureReason: string | null;
  runAt: string;
  paidAt: string | null;
}

export const getPayoutDestination = () =>
  api<{ destination: PayoutDestination | null }>('/business/payout-destination');

/**
 * Submitting SUPERSEDES the current number and starts again as UNVERIFIED
 * (§48.2) — payouts pause until an admin checks it. That is deliberate: a
 * business that has lost control of its SIM must be able to change the number
 * immediately, and the pause is what stops money going to whoever took it.
 */
export const submitPayoutDestination = (msisdn: string) =>
  api<PayoutDestination>('/business/payout-destination', {
    method: 'POST',
    body: { msisdn },
  });

export const getBalance = (businessId: string) =>
  api<Balance>(`/businesses/${businessId}/balance`);

export const listMyPayouts = (businessId: string) =>
  api<{ total: number; payouts: Payout[] }>(`/businesses/${businessId}/payouts`);

// ---------------------------------------------------------------------------
// Support tickets (§80)
//
// The reporter side of the same tickets the admin console answers. Internal
// admin notes are excluded by the server's query, so nothing here can leak one.
// ---------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type TicketCategory =
  | 'APPOINTMENT_DISPUTE'
  | 'PAYMENT_ISSUE'
  | 'TECHNICAL_ISSUE'
  | 'ACCOUNT_ISSUE'
  | 'OTHER';

/** The wording a business sees. The enum is shared; these labels are not. */
export const TICKET_CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: 'PAYMENT_ISSUE', label: 'Getting paid' },
  { value: 'APPOINTMENT_DISPUTE', label: 'A booking or a customer' },
  { value: 'ACCOUNT_ISSUE', label: 'My account or business profile' },
  { value: 'TECHNICAL_ISSUE', label: 'Something is broken' },
  { value: 'OTHER', label: 'Something else' },
];

export interface TicketAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TicketMessage {
  id: string;
  body: string;
  authorType: 'REPORTER' | 'ADMIN' | 'SYSTEM';
  createdAt: string;
  attachments: TicketAttachment[];
}

export interface Ticket {
  id: string;
  reference: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  reopenCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  /**
   * A file sent when the ticket was RAISED hangs off the ticket, not off the
   * opening message — verified against the running server. A reply's file
   * hangs off that message instead, so both places have to be rendered.
   */
  attachments: TicketAttachment[];
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
}

/**
 * What the server will actually take, mirrored from storage.service.ts
 * (`TICKET_MIME_TYPES`). Kept in step by hand; widening one without the other
 * turns a greyed-out file into a failed upload, or the reverse.
 */
export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * Also matched on extension. A browser hands over an empty or odd `type` for
 * HEIC and for some Office files depending on the OS, and a picker that greys
 * out a file the server would happily take is the bug this is fixing.
 */
export const ACCEPTED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  '.pdf', '.csv', '.txt', '.doc', '.docx', '.xls', '.xlsx',
];

export const ACCEPTED_LABEL = 'Images, PDF, Word, Excel, CSV or text';

/** Mirrors MAX_TICKET_ATTACHMENTS on the server (§83). */
export const MAX_ATTACHMENTS = 5;
export const MAX_UPLOAD_MB = 15;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** How long after being resolved a ticket can still be reopened (§24.3). */
export const REOPEN_WINDOW_DAYS = 14;

export const listMyTickets = (params: { status?: TicketStatus } = {}) =>
  api<{ total: number; tickets: Ticket[] }>('/tickets', { query: params });

export const getMyTicket = (id: string) => api<TicketDetail>(`/tickets/${id}`);

/**
 * Multipart, because files are optional but the endpoint is the same either
 * way — sending FormData with no file is a valid request.
 */
export const raiseTicket = (input: {
  category: TicketCategory;
  subject: string;
  body: string;
  attachments?: File[];
}) => {
  const form = new FormData();
  form.set('category', input.category);
  form.set('subject', input.subject);
  form.set('body', input.body);
  // `append`, not `set`: every file goes under the same field name, which is
  // what FilesInterceptor('attachments') collects.
  for (const file of input.attachments ?? []) form.append('attachments', file);
  return api<Ticket>('/tickets', { method: 'POST', body: form });
};

export const replyToMyTicket = (id: string, body: string, attachments: File[] = []) => {
  const form = new FormData();
  form.set('body', body);
  for (const file of attachments) form.append('attachments', file);
  return api<TicketMessage>(`/tickets/${id}/messages`, { method: 'POST', body: form });
};

export const reopenMyTicket = (id: string) =>
  api<Ticket>(`/tickets/${id}/reopen`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Shop-window images and per-location gallery (§88)
// ---------------------------------------------------------------------------

export interface GalleryPhoto {
  id: string;
  url: string;
  displayOrder: number;
}

export interface Gallery {
  photos: GalleryPhoto[];
  count: number;
  limit: number;
  remaining: number;
}

/**
 * The logo and cover are uploaded, not linked.
 *
 * The profile DTO has always taken `logoUrl` as a string, which assumed the
 * business already had the image hosted somewhere. They do not — that is the
 * whole reason they are here — so the bytes go up and the server records what
 * storage hands back.
 */
export const setProfileImage = (kind: 'logo' | 'cover', file: File) => {
  const form = new FormData();
  form.set('file', file);
  return api<BusinessProfile>(`/business/profile/image/${kind}`, {
    method: 'POST',
    body: form,
  });
};

export const getGallery = (locationId: string) =>
  api<Gallery>(`/business/locations/${locationId}/gallery`);

export const addGalleryPhoto = (locationId: string, file: File) => {
  const form = new FormData();
  form.set('file', file);
  return api<GalleryPhoto>(`/business/locations/${locationId}/gallery`, {
    method: 'POST',
    body: form,
  });
};

export const removeGalleryPhoto = (locationId: string, mediaId: string) =>
  api<void>(`/business/locations/${locationId}/gallery/${mediaId}`, {
    method: 'DELETE',
  });

/** Edits a branch. Coordinates cannot be removed once set (§43.2). */
/**
 * Opens a branch. OWNER and MANAGER only, like every other change to how the
 * business is set up.
 *
 * Coordinates are REQUIRED here and optional on update (§43.2): a branch with no
 * position cannot appear in a distance search, and being found by someone nearby
 * is the whole point of discovery. A business that onboarded without them is
 * invisible to the search that matters most, which is why new ones cannot.
 */
export const createLocation = (body: {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  districtId?: string;
  phone?: string;
}) => api<Location>('/business/locations', { method: 'POST', body });

export const updateLocation = (
  id: string,
  body: {
    name?: string;
    address?: string;
    phone?: string | null;
    latitude?: number;
    longitude?: number;
    districtId?: string;
  },
) => api<Location>(`/business/locations/${id}`, { method: 'PATCH', body });

/**
 * Closes a branch (§89). A soft close: bookings, reviews and history stay, the
 * branch stops taking new bookings and disappears from customer search. The
 * server refuses while appointments are still to happen.
 */
export const closeLocation = (id: string) =>
  api<{ message: string }>(`/business/locations/${id}`, { method: 'DELETE' });

export const reopenLocation = (id: string) =>
  api<{ message: string }>(`/business/locations/${id}/reopen`, { method: 'PATCH' });

// ---------------------------------------------------------------------------
// Staff and invitations (§90)
// ---------------------------------------------------------------------------

/**
 * OWNER is absent on purpose. There is exactly one owner per business and no
 * ownership transfer, so no invitation or role change may mint a second one —
 * the server refuses either way.
 */
export type StaffRole = 'MANAGER' | 'STAFF';

export type MemberStatus = 'ACTIVE' | 'REMOVED';

export interface Member {
  id: string;
  userId: string;
  email: string;
  role: 'OWNER' | StaffRole;
  status: MemberStatus;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: StaffRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  invitedBy: { id: string; email: string } | null;
}

/** Any active member may look; everything else here is OWNER-only. */
export const listMembers = () => api<Member[]>('/business/members');

export const listInvitations = () => api<Invitation[]>('/business/invitations');

export const inviteMember = (email: string, role: StaffRole) =>
  api<Invitation>('/business/members/invite', {
    method: 'POST',
    body: { email, role },
  });

export const revokeInvitation = (id: string) =>
  api<{ message: string }>(`/business/invitations/${id}`, { method: 'DELETE' });

export const setMemberRole = (membershipId: string, role: StaffRole) =>
  api<Member>(`/business/members/${membershipId}/role`, {
    method: 'PATCH',
    body: { role },
  });

/** Soft removal: the row stays as the record that this person had access. */
export const removeMember = (membershipId: string) =>
  api<{ message: string }>(`/business/members/${membershipId}`, {
    method: 'DELETE',
  });

// ---------------------------------------------------------------------------
// Closures and breaks (§91)
//
// Two different things, kept apart because they answer different questions.
// An exception replaces a WHOLE day: shut for a holiday, or different hours.
// A time block takes a slice OUT of a normal day: a lunch break, a meeting.
// ---------------------------------------------------------------------------

export interface ScheduleException {
  id: string;
  locationId: string;
  /** YYYY-MM-DD, serialised as a calendar date, never a timestamp. */
  date: string;
  isClosed: boolean;
  customOpenTime: string | null;
  customCloseTime: string | null;
  reason: string | null;
}

export interface TimeBlock {
  id: string;
  locationId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string | null;
}

export const listExceptions = (locationId: string) =>
  api<ScheduleException[]>(`/business/locations/${locationId}/schedule-exceptions`);

/**
 * Either close the day, or give it different hours — never both, and never
 * neither. The server refuses anything else, because a row that is not closed
 * and has no custom hours says nothing at all.
 */
export const createException = (
  locationId: string,
  body: {
    date: string;
    isClosed?: boolean;
    customOpenTime?: string;
    customCloseTime?: string;
    reason?: string;
  },
) =>
  api<ScheduleException>(`/business/locations/${locationId}/schedule-exceptions`, {
    method: 'POST',
    body,
  });

export const deleteException = (locationId: string, exceptionId: string) =>
  api<{ message: string }>(
    `/business/locations/${locationId}/schedule-exceptions/${exceptionId}`,
    { method: 'DELETE' },
  );

export const listTimeBlocks = (locationId: string) =>
  api<TimeBlock[]>(`/business/locations/${locationId}/time-blocks`);

export const createTimeBlock = (
  locationId: string,
  body: { date: string; startTime: string; endTime: string; reason?: string },
) =>
  api<TimeBlock>(`/business/locations/${locationId}/time-blocks`, {
    method: 'POST',
    body,
  });

export const deleteTimeBlock = (locationId: string, blockId: string) =>
  api<{ message: string }>(`/business/locations/${locationId}/time-blocks/${blockId}`, {
    method: 'DELETE',
  });

// ---------------------------------------------------------------------------
// Reviews, and the one reply a business gets (§92)
// ---------------------------------------------------------------------------

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  /** Set when the customer changed their review — context a reply needs. */
  editedAt: string | null;
  responseText: string | null;
  responseAt: string | null;
  responseEditedAt: string | null;
  createdAt: string;
  locationId: string;
  /** Never the customer's id or email: only the name they chose to show. */
  displayName: string;
}

export interface ReviewPage {
  locationId: string;
  ratingAvg: number | null;
  ratingCount: number;
  total: number;
  limit: number;
  offset: number;
  reviews: Review[];
}

/** How long a reply stays editable after it is posted. */
export const REVIEW_EDIT_WINDOW_DAYS = 7;

/**
 * Hidden reviews are excluded by the server for everyone, the business
 * included — so this is what the public sees, which is the point.
 */
export const listLocationReviews = (locationId: string, limit = 50) =>
  api<ReviewPage>(`/locations/${locationId}/reviews`, { query: { limit } });

/** One reply per review. A second is refused; edit the first instead. */
export const respondToReview = (reviewId: string, responseText: string) =>
  api<Review>(`/reviews/${reviewId}/response`, {
    method: 'POST',
    body: { responseText },
  });

export const updateReviewResponse = (reviewId: string, responseText: string) =>
  api<Review>(`/reviews/${reviewId}/response`, {
    method: 'PATCH',
    body: { responseText },
  });

// ---------------------------------------------------------------------------
// Notifications (§96)
//
// One inbox per account, whatever the role: the server guards these with the
// JWT alone and scopes every query to the caller's own id.
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  appointmentId: string | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  total: number;
  /** Unread across the whole inbox, not this page. */
  unread: number;
  limit: number;
  offset: number;
  notifications: Notification[];
}

export const listNotifications = (params: { unreadOnly?: boolean; limit?: number } = {}) =>
  api<NotificationPage>('/notifications', { query: params });

export const markNotificationRead = (id: string) =>
  api<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () =>
  api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });

// ---------------------------------------------------------------------------
// Analytics (§96)
// ---------------------------------------------------------------------------

export interface Analytics {
  businessId: string;
  locationId: string | null;
  scope: 'BUSINESS' | 'LOCATION';
  range: { from: string; to: string; days: number };
  appointments: {
    total: number;
    byStatus: Record<string, number>;
    completionRate: number;
    cancellationRate: number;
    noShowRate: number;
  };
  money: {
    /** The unit every amount below is in. Reported by the server (§96). */
    currency: string;
    collectedThroughPlatform: {
      depositsMinor: number;
      businessShareOfDepositsMinor: number;
      appointmentCount: number;
      cancelledWithUnknownPaymentState: number;
      /** False means the figure is partial, and says so rather than rounding. */
      complete: boolean;
      note: string;
    };
    platformFeesPaidMinor: number;
    balanceOwedToBusiness: {
      amountMinor: number;
      fromAppointments: number;
      appointmentsMissingSnapshot: number;
      complete: boolean;
      note: string;
    };
  };
  reviews: { count: number; averageRating: number | null };
  busiest: {
    dayOfWeek: { day: number; appointments: number } | null;
    hour: { hour: number; appointments: number } | null;
    timeZone: string;
  };
}

export const getAnalytics = (
  businessId: string,
  params: { locationId?: string; from?: string; to?: string } = {},
) => api<Analytics>(`/businesses/${businessId}/analytics`, { query: params });

/**
 * One appointment in full (§96).
 *
 * The list carries what a day's schedule needs; this carries the payment trail
 * — when the deposit landed, the operator's reference, the rate used — which is
 * what a business reaches for when a customer disputes a charge.
 */
export const getAppointment = (id: string) =>
  api<Appointment & {
    depositPaidAt: string | null;
    paymentInitiatedAt: string | null;
    paymentProviderReferenceId: string | null;
    providerCurrency: string | null;
    providerAmountMinor: number | null;
    exchangeRateUsed: string | null;
    servicePriceMinor: number | null;
    depositPercentage: string | null;
    platformFeePercentage: string | null;
    verificationCodeSentAt: string | null;
    verifiedAt: string | null;
    completedAt: string | null;
    noShowAt: string | null;
    cancelledAt: string | null;
    cancelledBy: string | null;
    cancellationReason: string | null;
    createdAt: string;
  }>(`/appointments/${id}`);

// ---------------------------------------------------------------------------
// Where a branch is (§104)
// ---------------------------------------------------------------------------

export interface District {
  id: string;
  code: string;
  name: string;
}

export interface Province {
  id: string;
  code: string;
  name: string;
  districts: District[];
}

export const listProvinces = () =>
  api<Province[]>('/places/provinces', { anonymous: true });

// ---------------------------------------------------------------------------
// Pausing the shop (§119.3)
// ---------------------------------------------------------------------------

/**
 * Stops NEW bookings and takes every branch out of search, reversibly.
 *
 * OWNER only. Not a status change: `SUSPENDED` is what an admin does to a
 * business, with a reason the business is told — a holiday and a sanction must
 * not look the same in an admin listing.
 *
 * Nothing is lost. Bookings already made still happen, money already owed is
 * still paid out. Pausing is not a way to walk away from either.
 */
export const pauseBusiness = () =>
  api<{ id: string; name: string | null; pausedAt: string | null }>('/business/pause', {
    method: 'POST',
  });

export const resumeBusiness = () =>
  api<{ id: string; name: string | null; pausedAt: string | null }>('/business/resume', {
    method: 'POST',
  });

// ---------------------------------------------------------------------------
// Legal documents (§122)
// ---------------------------------------------------------------------------

export interface LegalStatus {
  id: string;
  kind: 'TERMS_OF_USE' | 'PRIVACY_POLICY' | 'SELLER_AGREEMENT';
  version: number;
  title: string;
  body: string;
  publishedAt: string;
  changeNote: string | null;
  acceptedVersion: number | null;
  acceptedAt: string | null;
  /** True when they never agreed, or agreed to an older version. */
  needsAcceptance: boolean;
}

export const myLegalStatus = () => api<LegalStatus[]>('/legal/me');

export const acceptLegal = (documentId: string) =>
  api<{ documentId: string; version: number }>('/legal/me/accept', {
    method: 'POST',
    body: { documentId },
  });
