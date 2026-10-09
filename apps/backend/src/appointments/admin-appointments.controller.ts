import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ListAdminAppointmentsDto } from './dto/list-admin-appointments.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  AdminAppointmentDetailDto,
  AdminAppointmentPageDto,
  AppointmentDto,
} from './dto/appointment.dto';

/**
 * Dispute resolution. API-only, like every other admin surface here (§16.9).
 *
 * Deliberately narrow: an admin may read any booking (§249) and say a
 * cancellation was the business's responsibility, which triggers the refund
 * §25 requires. They cannot edit amounts or reclassify in the other direction.
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
}
