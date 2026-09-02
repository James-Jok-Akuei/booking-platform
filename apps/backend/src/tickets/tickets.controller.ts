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
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';

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
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** multipart, so an optional screenshot can accompany the report. */
  @Post()
  @UseInterceptors(FileInterceptor('attachment', ticketUploadOptions))
  @UseFilters(MulterExceptionFilter)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() attachment: Express.Multer.File | undefined,
    @Body() dto: CreateTicketDto,
  ) {
    return this.tickets.create(user, dto, attachment);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTicketsDto) {
    return this.tickets.list(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.findOne(user, id);
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

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.reopen(user, id);
  }
}
