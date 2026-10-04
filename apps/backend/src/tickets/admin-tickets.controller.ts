import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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
import { MAX_TICKET_ATTACHMENTS } from '../storage/storage.service';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  PostedTicketMessageDto,
  TicketDetailDto,
  TicketDto,
  TicketPageDto,
} from './dto/ticket-response.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ListAdminTicketsDto } from './dto/list-tickets.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

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
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @ApiOkResponse({ type: TicketPageDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminTicketsDto,
  ) {
    return this.tickets.listForAdmin(user, query);
  }

  /** Includes internal notes — the one view that does. */
  @Get(':id')
  @ApiOkResponse({ type: TicketDetailDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.findOne(user, id);
  }

  @Patch(':id/assign')
  @ApiOkResponse({ type: TicketDto })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.tickets.assign(user, id, dto.assignedAdminId);
  }

  /**
   * Moves the ticket through its lifecycle. `resolutionNote` is required for
   * RESOLVED, and an optional billing adjustment may ride along — see
   * TicketsService.recordBillingAdjustment for what that does, and does not, do.
   */
  @Patch(':id/status')
  @ApiOkResponse({ type: TicketDto })
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
      // Verified against the claim above, so 'ADMIN' cannot simply be asserted.
      actorRole: user.role,
      resolutionNote: dto.resolutionNote,
      billingAdjustment: dto.billingAdjustment,
    });
  }

  @Post(':id/messages')
  @ApiCreatedResponse({ type: PostedTicketMessageDto })
  @UseInterceptors(FilesInterceptor('attachments', MAX_TICKET_ATTACHMENTS, ticketUploadOptions))
  @UseFilters(
    new MulterExceptionFilter({
      maxFiles: MAX_TICKET_ATTACHMENTS,
      field: 'attachments',
      noun: 'file',
    }),
  )
  addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() attachments: Express.Multer.File[] | undefined,
    @Body() dto: CreateTicketMessageDto,
  ) {
    return this.tickets.addMessage(user, id, dto, attachments);
  }
}
