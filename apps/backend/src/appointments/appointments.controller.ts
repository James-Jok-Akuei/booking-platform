import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import { BusinessRolesGuard } from '../business/guards/business-roles.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { InitiateDepositPaymentDto } from './dto/initiate-payment.dto';
import { VerifyAppointmentDto } from './dto/verify-appointment.dto';
import { ManualVerifyAppointmentDto } from './dto/manual-verify-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { UpdateBookingChoicesDto } from './dto/update-booking-choices.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  InitiateDepositPaymentResponseDto,
  PaymentStatusResponseDto,
} from './dto/payment-status.dto';
import {
  AppointmentDto,
  AppointmentPageDto,
  CustomerAppointmentDetailDto,
} from './dto/appointment.dto';

/**
 * Customer-side booking.
 *
 * Split from the business-side controller below because the two are guarded
 * differently: this one requires a CUSTOMER account, that one requires business
 * membership. Mixing them would mean per-method guard juggling on one class.
 */
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true, rateLimited: true })
export class AppointmentsCustomerController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @ApiCreatedResponse({ type: AppointmentDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointments.create(user.userId, dto);
  }

  /**
   * Starts collecting the deposit through the payment provider.
   *
   * Replaced the temporary `mark-deposit-paid` seam, which moved the status
   * without moving money. The appointment stays PENDING_PAYMENT until the
   * payment is confirmed — see AppointmentsService.initiateDepositPayment.
   */
  /**
   * A fresh arrival code, emailed to the customer (§54.1).
   *
   * The CUSTOMER's route, not the business's: a code the business could summon
   * on demand is a code the business controls, and its only job is to be
   * something the business does not have.
   */
  /**
   * Changes wishes and the note, until 2 hours before (§300.7). Answers that
   * changed the price or the time stay as booked. The shop is told.
   */
  @Patch(':id/choices')
  @ApiOkResponse({ type: CustomerAppointmentDetailDto })
  changeChoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingChoicesDto,
  ) {
    return this.appointments.changeChoices(user.userId, id, dto);
  }

  @Post(':id/resend-verification-code')
  @ApiOkResponse({ type: CustomerAppointmentDetailDto })
  @HttpCode(HttpStatus.OK)
  resendVerificationCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.resendVerificationCode(user.userId, id);
  }

  /**
   * Ten a minute. Every call makes a prompt appear on somebody's handset and a
   * request to MTN, so a loop here is a person's phone buzzing and a bill the
   * platform pays. The service already refuses a second attempt while one is in
   * flight; this bounds the attempts themselves.
   */
  @Post(':id/initiate-deposit-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: InitiateDepositPaymentResponseDto })
  initiateDepositPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitiateDepositPaymentDto,
  ) {
    return this.appointments.initiateDepositPayment(
      user.userId,
      id,
      dto.phoneNumber,
      dto.provider,
    );
  }
}

/**
 * Business-side appointment handling.
 *
 * All three transitions here are open to STAFF as well as OWNER and MANAGER.
 * This is what §14 deferred: staff were read-only because the thing they
 * actually do — run the day's appointments — did not exist yet. Verifying an
 * arrival, completing a service and recording a no-show are precisely the
 * receptionist's job, and none of them changes the business's configuration,
 * which is what the OWNER/MANAGER line protects.
 */
@Controller('business/appointments')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AppointmentsBusinessController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post(':id/verify')
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyAppointmentDto,
  ) {
    return this.appointments.verify(user.userId, id, dto.code);
  }

  /**
   * Verification without the code (§54.3).
   *
   * OWNER and MANAGER only, unlike `verify` above, which STAFF may also use.
   * Taking a code the customer reads out is counter work; deciding to proceed
   * WITHOUT one is a judgement about whether a stranger is who they say they
   * are, and it is recorded against whoever makes it.
   */
  @Post(':id/verify-manually')
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  verifyManually(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualVerifyAppointmentDto,
  ) {
    return this.appointments.verifyManually(user.userId, id, dto.note);
  }

  @Post(':id/complete')
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.complete(user.userId, id);
  }

  @Post(':id/no-show')
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(HttpStatus.OK)
  @BusinessRoles(
    BusinessMemberRole.OWNER,
    BusinessMemberRole.MANAGER,
    BusinessMemberRole.STAFF,
  )
  noShow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.noShow(user.userId, id);
  }
}

/**
 * Reads and cancellation, open to both sides.
 *
 * Cancelling and viewing are the two things a customer and a business member do
 * to the same appointment, so they share a route guarded only by JwtAuthGuard;
 * AppointmentsService then decides what this particular caller may see or do.
 */
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
// Explicit, rather than relying on the absence of @Roles meaning "any
// authenticated user". RolesGuard passes anything through when the decorator is
// missing, so an ADMIN token used to reach findAll and be refused by the SERVICE
// — the same fall-through already fixed in Chat (§23.1) and appointments'
// own findAll (§27). The service check below stays as the second layer (§41).
@Roles(UserRole.CUSTOMER, UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AppointmentsSharedController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @ApiOkResponse({ type: AppointmentPageDto })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAppointmentsDto,
  ) {
    // AuthenticatedUser.role is the same string union as UserRole; the cast
    // keeps the service's signature typed without touching the auth decorator.
    return this.appointments.findAll(user.userId, user.role as UserRole, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CustomerAppointmentDetailDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.findOne(user.userId, id);
  }

  /**
   * Live payment status, queried straight from the provider.
   *
   * Exists so a frontend can poll immediately after initiating rather than
   * waiting for the background job's cycle. Open to either participant: the
   * business needs to see whether the deposit landed just as much as the
   * customer does.
   */
  @Get(':id/payment-status')
  @ApiOkResponse({ type: PaymentStatusResponseDto })
  paymentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.getPaymentStatus(user.userId, id);
  }

  /** Either the customer who booked it or an active member of its business. */
  @Post(':id/cancel')
  @ApiOkResponse({ type: AppointmentDto })
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.appointments.cancel(user.userId, id, dto);
  }
}
