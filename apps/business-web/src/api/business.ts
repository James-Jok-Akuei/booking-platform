import { api } from './client';
import type { components } from './schema';

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

/**
 * From the contract (§128). A business sees the shared projection — no arrival
 * code, no customer's review — and that difference is now the type system's to
 * keep rather than this file's to remember.
 */
export type Appointment = components['schemas']['AppointmentDto'];


export type AppointmentPage = components['schemas']['AppointmentPageDto'];

/** Derived from the contract (§128). */
export type Me = components['schemas']['MeDto'];
export type BusinessMembership = NonNullable<Me['businessMembership']>;

/**
 * How to render money (§70.1).
 *
 * Fetched, never assumed. Dividing by 100 is correct in a two-decimal currency
 * and wrong by a factor of a hundred in a currency with no minor unit — the
 * §55.2 mistake, moved to the front end where it is harder to see.
 */
export type Currency = components['schemas']['CurrencyDto'];

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

/**
 * From the contract (§128). `status` arrives as the real enum rather than
 * `string`, so a screen cannot branch on a status the server never sends.
 */
export type BusinessProfile = components['schemas']['BusinessProfileDto'];


/**
 * Where a service is offered, and what it costs there (§72). From the contract
 * (§128) — and named `ServiceOfferedAtDto` there because the request body
 * already owns `ServiceOfferDto`, and OpenAPI names are global (§128.7).
 */
export type ServiceOffer = components['schemas']['ServiceOfferedAtDto'];


/**
 * From the contract (§128). Price is per branch (§72), so `locations` carries
 * the offers rather than a number sitting on the service.
 */
export type Service = components['schemas']['BusinessServiceDto'];


export type Hours = components['schemas']['LocationHoursDto'];

/**
 * From the contract (§128.5). The include it describes is the one the query
 * uses — literally the same constant — so a relation added to that query without
 * a field added to the class fails the backend build, and a field removed from
 * the class fails this one.
 */
export type Location = components['schemas']['BusinessLocationDto'];
/** Changing capacity answers with its own narrow shape, not a whole location (§128.25). */
export type LocationCapacity = components['schemas']['LocationCapacityDto'];
export type ActionMessage = components['schemas']['ActionMessageDto'];
export type BusinessPauseState = components['schemas']['BusinessPauseStateDto'];


export type Category = components['schemas']['CategoryDto'];

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
  /** The headline under the photos on the service's page (§185). */
  title?: string | null;
  description?: string | null;
  /** What to know before coming (§180). Blank is stored as nothing. */
  instructions?: string | null;
  /** A sale (§186): whole percent off, 1–90; null ends it. */
  discountPercent?: number | null;
  /** The sale's last day, YYYY-MM-DD; null runs until it is ended. */
  discountEndsOn?: string | null;
  durationMinutes: number;
  depositPercentage: number;
  /** §136. Left out, a service is booked one at a time. */
  quantityMode?: Service['quantityMode'];
  maxQuantity?: number;
  offers: Array<{ locationId: string; priceMinor: number }>;
}) => api<Service>('/business/services', { method: 'POST', body });

export const updateService = (
  id: string,
  body: Partial<{
    name: string;
    title: string | null;
    description: string | null;
    instructions: string | null;
    discountPercent: number | null;
    discountEndsOn: string | null;
    durationMinutes: number;
    depositPercentage: number;
    quantityMode: Service['quantityMode'];
    maxQuantity: number;
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
  api<LocationCapacity>(`/business/locations/${locationId}/capacity`, {
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

export type PayoutDestination = components['schemas']['PayoutDestinationDto'];

export type Balance = components['schemas']['BusinessBalanceDto'];

export type Payout = components['schemas']['PayoutDto'];

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

export type TicketStatus = Ticket['status'];
export type TicketCategory = Ticket['category'];

/** The wording a business sees. The enum is shared; these labels are not. */
export const TICKET_CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: 'PAYMENT_ISSUE', label: 'Getting paid' },
  { value: 'APPOINTMENT_DISPUTE', label: 'A booking or a customer' },
  { value: 'ACCOUNT_ISSUE', label: 'My account or business profile' },
  { value: 'TECHNICAL_ISSUE', label: 'Something is broken' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * Derived from the contract (§128).
 *
 * `attachments` is on the DETAIL type only. It used to be on `Ticket` as well,
 * which the listing has never sent — its select carries no attachments at all
 * (§128.31).
 */
export type TicketAttachment = components['schemas']['TicketAttachmentDto'];
export type TicketMessage = components['schemas']['TicketMessageDto'];
export type Ticket = components['schemas']['TicketDto'];
export type TicketDetail = components['schemas']['TicketDetailDto'];
export type TicketPage = components['schemas']['TicketPageDto'];
export type PostedTicketMessage = components['schemas']['PostedTicketMessageDto'];

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

/**
 * Derived from the contract (§128). The hand-written version carried only id,
 * url and displayOrder — so the owner's own management view could not show
 * whether a photo was still PENDING moderation.
 */
export type GalleryPhoto = components['schemas']['GalleryPhotoDto'];
export type Gallery = components['schemas']['GalleryDto'];

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

// ---------------------------------------------------------------------------
// Photos of a service (§132)
// ---------------------------------------------------------------------------

export type ServiceImage = components['schemas']['ServiceImageDto'];
export type ServiceImages = components['schemas']['ServiceImagesDto'];

/**
 * Up to eleven per service. The limit and how much room is left come from the
 * server (`getServiceImages`), so this app never hardcodes the number.
 */
export const getServiceImages = (serviceId: string) =>
  api<ServiceImages>(`/business/services/${serviceId}/images`);

export const addServiceImage = (serviceId: string, file: File) => {
  const form = new FormData();
  form.set('file', file);
  return api<ServiceImage>(`/business/services/${serviceId}/images`, {
    method: 'POST',
    body: form,
  });
};

/**
 * Makes a photo the cover (§187) — the one customers see on the service's
 * card. The others keep their order behind it. Answers with the new listing.
 */
export const setServiceImageCover = (serviceId: string, imageId: string) =>
  api<ServiceImages>(`/business/services/${serviceId}/images/${imageId}/cover`, {
    method: 'PATCH',
  });

export const removeServiceImage = (serviceId: string, imageId: string) =>
  api<ActionMessage>(`/business/services/${serviceId}/images/${imageId}`, {
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

export type Member = components['schemas']['BusinessMemberDto'];
export type Invitation = components['schemas']['BusinessInvitationDto'];
export type RemovedMember = components['schemas']['RemovedMemberDto'];

/** Any active member may look; everything else here is OWNER-only. */
export const listMembers = () => api<Member[]>('/business/members');

export const listInvitations = () => api<Invitation[]>('/business/invitations');

export const inviteMember = (email: string, role: StaffRole) =>
  api<Invitation>('/business/members/invite', {
    method: 'POST',
    body: { email, role },
  });

export const revokeInvitation = (id: string) =>
  api<ActionMessage>(`/business/invitations/${id}`, { method: 'DELETE' });

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

export type ScheduleException = components['schemas']['ScheduleExceptionDto'];

export type TimeBlock = components['schemas']['TimeBlockDto'];

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

export type Review = components['schemas']['ReviewDto'];

export type ReviewPage = components['schemas']['LocationReviewsDto'];

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

export type Notification = components['schemas']['NotificationDto'];

export type NotificationPage = components['schemas']['NotificationPageDto'];

export const listNotifications = (params: { unreadOnly?: boolean; limit?: number } = {}) =>
  api<NotificationPage>('/notifications', { query: params });

export const markNotificationRead = (id: string) =>
  api<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () =>
  api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });

// ---------------------------------------------------------------------------
// Analytics (§96)
// ---------------------------------------------------------------------------

export type Analytics = components['schemas']['BusinessAnalyticsDto'];

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

export type District = components['schemas']['DistrictDto'];

export type Province = components['schemas']['ProvinceDto'];

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

/** From the contract (§128). */
export type LegalStatus = components['schemas']['LegalStatusDto'];


export const myLegalStatus = () => api<LegalStatus[]>('/legal/me');

export const acceptLegal = (documentId: string) =>
  api<{ documentId: string; version: number }>('/legal/me/accept', {
    method: 'POST',
    body: { documentId },
  });

// ---------------------------------------------------------------------------
// Service drafts (§123)
// ---------------------------------------------------------------------------

export type ServiceDraft = components['schemas']['ServiceDraftDto'];

/** The shop's unfinished services, newest first. Shared, not per person (§123). */
export const listServiceDrafts = () => api<ServiceDraft[]>('/business/service-drafts');

export const startServiceDraft = () =>
  api<ServiceDraft>('/business/service-drafts', { method: 'POST' });

/** Saves whatever has been typed. Nothing here is validated — that is the point. */
export const saveServiceDraft = (
  id: string,
  body: {
    name?: string | null;
    title?: string | null;
    description?: string | null;
    instructions?: string | null;
    discountPercent?: number | null;
    discountEndsOn?: string | null;
    durationMinutes?: number | null;
    depositPercentage?: number | null;
    offers?: Array<{ locationId: string; priceMinor: number }>;
  },
) => api<ServiceDraft>(`/business/service-drafts/${id}`, { method: 'PATCH', body });

/** A real delete, unlike almost everything else here: a draft is nobody's record. */
export const discardServiceDraft = (id: string) =>
  api<{ message: string }>(`/business/service-drafts/${id}`, { method: 'DELETE' });
