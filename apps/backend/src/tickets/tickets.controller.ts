import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * Reporter-facing support tickets.
 *
 * Guarded with JwtAuthGuard + RolesGuard restricted to CUSTOMER and BUSINESS —
 * the guard layer establishes *who may reach these routes at all*, and the
 * service scopes every query to what that caller may see. Both layers, as
 * everywhere else in this project.
 *
 * Internal admin notes never appear in any response here: they are excluded in
 * the query, not stripped from the result.
 */
@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** multipart, so an optional screenshot can accompany the report. */
  @Post()
  @ApiCreatedResponse({ type: TicketDto })
  @UseInterceptors(FilesInterceptor('attachments', MAX_TICKET_ATTACHMENTS, ticketUploadOptions))
  @UseFilters(
    new MulterExceptionFilter({
      maxFiles: MAX_TICKET_ATTACHMENTS,
      field: 'attachments',
      noun: 'file',
    }),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() attachments: Express.Multer.File[] | undefined,
    @Body() dto: CreateTicketDto,
  ) {
    return this.tickets.create(user, dto, attachments);
  }

  @Get()
  @ApiOkResponse({ type: TicketPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTicketsDto) {
    return this.tickets.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: TicketDetailDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.findOne(user, id);
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

  @Post(':id/reopen')
  @ApiOkResponse({ type: TicketDto })
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.reopen(user, id);
  }
}
