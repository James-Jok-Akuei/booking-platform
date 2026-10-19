import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AppointmentsService } from './appointments.service';
import { ReclassifyCancellationDto } from './dto/cancel-appointment.dto';
import {
  SupportCheckInDto,
  SupportConversationDto,
  SupportDoneDto,
  SupportPaymentCheckDto,
  SupportReasonDto,
  SupportTicketOnlyDto,
} from '../support/support.dto';
import { ListAdminAppointmentsDto } from './dto/list-admin-appointments.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  AdminAppointmentDetailDto,
  AdminAppointmentPageDto,
  AppointmentDto,
} from './dto/appointment.dto';

/**
 * Bookings, for our support team (§249, §297).
 *
 * An admin may read any booking, and act on one the way its shop or its
 * customer would when they cannot — check in, mark done, put a wrong no-show
 * right, cancel on either side, send a new code, ask MTN about a payment,
 * read the conversation. Every act needs a reason, is written to the support
 * log, and is shown on the booking to both sides. Amounts are never edited.
 */
@Controller('admin/appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /**
   * The listing (§95). Without it the PATCH below took an id that nothing in
   * the platform produced.
   */
  @Get()
  @ApiOkResponse({ type: AdminAppointmentPageDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminAppointmentsDto,
  ) {
    return this.appointments.listForAdmin(user, query);
  }

  /** One booking, with its payment, steps, ledger lines, review and tickets (§249). */
  @Get(':id')
  @ApiOkResponse({ type: AdminAppointmentDetailDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointments.findOneForAdmin(user, id);
  }

  @Patch(':id/business-cancellation')
  @ApiOkResponse({ type: AppointmentDto })
  reclassify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReclassifyCancellationDto,
  ) {
    return this.appointments.reclassifyAsBusinessCancellation(user, id, dto);
  }

  /** Check the customer in for the shop: with their code, or saying how we know they came. */
  @Post(':id/check-in')
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  checkIn(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportCheckInDto) {
    return this.appointments.supportCheckIn(user, id, dto);
  }

  /** Mark it done for the shop — checking the customer in first when it is still expected. */
  @Post(':id/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportCheckInDto) {
    return this.appointments.supportComplete(user, id, dto);
  }

  /** A wrong no-show put right: the customer came; it counts as done. */
  @Post(':id/fix-no-show')
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  fixNoShow(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportReasonDto) {
    return this.appointments.supportFixNoShow(user, id, dto);
  }

  /** Cancel for a customer who asked us to. Their deposit is not given back, as when they cancel. */
  @Post(':id/cancel-for-customer')
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  cancelForCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.appointments.supportCancelForCustomer(user, id, dto);
  }

  /** A new arrival code, emailed to the customer. */
  @Post(':id/resend-code')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportDoneDto })
  resendCode(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportReasonDto) {
    return this.appointments.supportResendCode(user, id, dto);
  }

  /** Ask MTN about the deposit now, and apply what it says. */
  @Post(':id/check-payment')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportPaymentCheckDto })
  checkPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportTicketOnlyDto,
  ) {
    return this.appointments.supportCheckPayment(user, id, dto.ticketId);
  }

  /** The booking's conversation, read-only — the reading is written down and shown on the booking. */
  @Post(':id/messages')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportConversationDto })
  readMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupportReasonDto,
  ) {
    return this.appointments.supportReadMessages(user, id, dto);
  }
}
