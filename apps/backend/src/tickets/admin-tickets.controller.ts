import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { MulterExceptionFilter } from '../business/filters/multer-exception.filter';
import { TicketsService } from './tickets.service';
import { ticketUploadOptions } from './ticket-upload.options';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ListAdminTicketsDto } from './dto/list-tickets.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';

/**
 * The admin ticket queue.
 *
 * API-only. There is no admin portal, exactly as with the platform-fee and
 * exchange-rate settings (§16.9) — and per DECISIONS.md §3 an ADMIN account
 * cannot be created through the auth flow at all, so reaching these routes
 * requires a manually seeded admin.
 */
@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Query() query: ListAdminTicketsDto) {
    return this.tickets.listForAdmin(query);
  }

  /** Includes internal notes — the one view that does. */
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.findOne(user, id);
  }

  @Patch(':id/assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.tickets.assign(id, dto.assignedAdminId);
  }

  /**
   * Moves the ticket through its lifecycle. `resolutionNote` is required for
   * RESOLVED, and an optional billing adjustment may ride along — see
   * TicketsService.recordBillingAdjustment for what that does, and does not, do.
   */
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.tickets.transitionStatus({
      ticketId: id,
      to: dto.status,
      actor: 'ADMIN',
      actorUserId: user.userId,
      resolutionNote: dto.resolutionNote,
      billingAdjustment: dto.billingAdjustment,
    });
  }

  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('attachment', ticketUploadOptions))
  @UseFilters(MulterExceptionFilter)
  addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() attachment: Express.Multer.File | undefined,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.tickets.addMessage(user, id, dto, attachment);
  }
}
