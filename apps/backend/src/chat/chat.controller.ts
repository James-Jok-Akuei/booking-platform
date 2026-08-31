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
import { ChatService } from './chat.service';
import { chatUploadOptions } from './chat-upload.options';
import { CreateInquiryThreadDto } from './dto/create-inquiry.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListThreadsDto } from './dto/list-threads.dto';
import { ListMessagesDto } from './dto/list-messages.dto';

/**
 * Chat between a customer and a business.
 *
 * Guarded by JwtAuthGuard only, apart from the inquiry endpoint. Both sides use
 * the same routes, and participation is enforced per-thread inside the service
 * by scoping every query to the caller — a customer to their own threads, a
 * business member to their business's. There is no role-level rule to apply
 * here beyond "be signed in".
 */
@Controller('threads')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * Opens (or returns) the inquiry thread with a business.
   *
   * CUSTOMER-only: a business does not cold-open a conversation with someone
   * who has not contacted them, which would make this an outbound-marketing
   * tool rather than a support channel.
   */
  @Post('inquiry')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  createInquiry(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInquiryThreadDto,
  ) {
    return this.chat.createInquiryThread(user.userId, dto.businessProfileId);
  }

  @Get()
  listThreads(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListThreadsDto,
  ) {
    return this.chat.listThreads(
      user.userId,
      user.role,
      query.limit ?? 25,
      query.offset ?? 0,
    );
  }

  @Get(':id')
  getThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.getThread(user.userId, id, user.role);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.chat.listMessages(
      user.userId,
      id,
      user.role,
      query.limit ?? 50,
      query.offset ?? 0,
    );
  }

  /**
   * Sends a message: text, a photo, or both.
   *
   * multipart/form-data so a photo can ride along with the text, the same shape
   * as the gallery upload, and reusing its exact limits — 15MB, jpg/png/webp —
   * plus MulterExceptionFilter so an oversized file gets the same clear error
   * rather than a bare 500.
   */
  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('photo', chatUploadOptions))
  @UseFilters(MulterExceptionFilter)
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage({
      userId: user.userId,
      role: user.role,
      threadId: id,
      body: dto.body,
      file: photo,
    });
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.markRead(user.userId, id, user.role);
  }
}
