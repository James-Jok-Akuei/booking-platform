import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  MarkAllReadDto,
  MarkReadDto,
  NotificationPageDto,
  DismissedDto,
  DismissedManyDto,
} from './dto/notification-response.dto';

/**
 * A person's own notification inbox.
 *
 * Guarded only by JwtAuthGuard — customers, business members and admins all
 * have an inbox, and every query is scoped to the caller's own id inside the
 * service, so there is nothing role-specific to enforce here.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiErrors({ auth: true, validation: true, notFound: true })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notifications.list(
      user.userId,
      query.unreadOnly ?? false,
      query.limit ?? 25,
      query.offset ?? 0,
    );
  }

  @Patch('read-all')
  @ApiOkResponse({ type: MarkAllReadDto })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }

  /** Declared before ':id', so the word "read" is never read as an id. */
  @Delete('read')
  @ApiOkResponse({ type: DismissedManyDto })
  dismissRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.dismissRead(user.userId);
  }

  @Delete(':id')
  @ApiOkResponse({ type: DismissedDto })
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.dismiss(user.userId, id);
  }

  @Patch(':id/read')
  @ApiOkResponse({ type: MarkReadDto })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.userId, id);
  }
}
