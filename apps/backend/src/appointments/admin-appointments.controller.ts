import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
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

/**
 * Dispute resolution. API-only, like every other admin surface here (§16.9).
 *
 * One route, and deliberately narrow: an admin may say a cancellation was the
 * business's responsibility, which triggers the refund §25 requires. They
 * cannot edit amounts, reclassify in the other direction, or reach anything
 * else about an appointment from here.
 */
@Controller('admin/appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Patch(':id/business-cancellation')
  reclassify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReclassifyCancellationDto,
  ) {
    return this.appointments.reclassifyAsBusinessCancellation(user, id, dto);
  }
}
