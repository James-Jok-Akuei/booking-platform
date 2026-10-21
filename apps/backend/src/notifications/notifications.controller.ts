import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  Delete,
  Body,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { RequestLocale } from '../i18n/request-locale.decorator';
import { DATE_TAGS, say } from '../i18n/say';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationIdsDto } from './dto/notification-ids.dto';
import { ApiExcludeEndpoint, ApiOkResponse } from '@nestjs/swagger';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushService } from './push.service';
import {
  NotificationSettingsDto,
  RegisterDeviceDto,
  RegisterDeviceResultDto,
  UnregisterDeviceDto,
  UnregisterDeviceResultDto,
  UpdateNotificationSettingsDto,
} from './dto/notification-settings.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import {
  MarkAllReadDto,
  MarkReadDto,
  NotificationPageDto,
  DismissedDto,
  DismissedManyDto,
  ReadManyDto,
  RestoredManyDto,
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
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly push: PushService,
  ) {}

  // ---------- What to send, and where (§287). Declared before ':id'. ----------

  @Get('settings')
  @ApiOkResponse({ type: NotificationSettingsDto })
  async settings(@CurrentUser() user: AuthenticatedUser, @RequestLocale() locale: Locale): Promise<NotificationSettingsDto> {
    return this.withDevices(user.userId, await this.preferences.settings(user.userId, locale));
  }

  @Patch('settings')
  @ApiOkResponse({ type: NotificationSettingsDto })
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationSettingsDto,
    @RequestLocale() locale: Locale,
  ): Promise<NotificationSettingsDto> {
    const source =
      dto.source ??
      (user.role === UserRole.ADMIN
        ? 'admin-console'
        : user.role === UserRole.BUSINESS
          ? 'seller-app'
          : 'customer-app');
    return this.withDevices(user.userId, await this.preferences.update(user.userId, { ...dto, source }, locale));
  }

  /** A phone or a browser that may now be sent pushes. */
  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RegisterDeviceResultDto })
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.push.register(user.userId, dto);
  }

  /** Forgets one — on sign-out there, or when alerts are turned off there. */
  @Delete('devices')
  @ApiOkResponse({ type: UnregisterDeviceResultDto })
  unregisterDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnregisterDeviceDto) {
    return this.push.unregister(user.userId, dto.token);
  }

  private async withDevices(
    userId: string,
    settings: Awaited<ReturnType<NotificationPreferencesService['settings']>>,
  ): Promise<NotificationSettingsDto> {
    const devices = await this.push.devicesOf(userId);
    return {
      ...settings,
      devices: devices.map((d) => ({
        ...d,
        lastSeenAt: d.lastSeenAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
      })),
      webPushKey: this.push.vapidPublicKey,
    };
  }

  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsDto) {
    return this.notifications.list(user.userId, query.unreadOnly ?? false, query.limit ?? 25, query.offset ?? 0);
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

  /** Several at once, from a selection (§162). */
  @Delete()
  @ApiOkResponse({ type: DismissedManyDto })
  dismissMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: NotificationIdsDto) {
    return this.notifications.dismissMany(user.userId, dto.ids);
  }

  @Patch('restore')
  @ApiOkResponse({ type: RestoredManyDto })
  restoreMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: NotificationIdsDto) {
    return this.notifications.restoreMany(user.userId, dto.ids);
  }

  @Patch('read-many')
  @ApiOkResponse({ type: ReadManyDto })
  markReadMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: NotificationIdsDto) {
    return this.notifications.markReadMany(user.userId, dto.ids);
  }

  @Delete(':id')
  @ApiOkResponse({ type: DismissedDto })
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.dismiss(user.userId, id);
  }

  @Patch(':id/restore')
  @ApiOkResponse({ type: DismissedDto })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.restore(user.userId, id);
  }

  @Patch(':id/read')
  @ApiOkResponse({ type: MarkReadDto })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.userId, id);
  }
}

/**
 * "Stop emails like this", from an email's footer (§287). No sign-in, on
 * purpose — like the offers link (§140): a way out behind a password is one
 * people do not finish, and report as spam instead. The link is signed, and
 * only ever turns email OFF for one kind.
 */
@Controller('notifications/unsubscribe')
export class NotificationUnsubscribeController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  /** What a mail app's own "Unsubscribe" button sends (RFC 8058). */
  @Post()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.NO_CONTENT)
  async oneClick(@Query('u') u: string, @Query('c') c: string, @Query('t') t: string): Promise<void> {
    await this.preferences.unsubscribe(u, c, t);
  }

  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async page(@Query('u') u: string, @Query('c') c: string, @Query('t') t: string): Promise<string> {
    const result: { ok: boolean; title?: string; locale?: Locale } = await this.preferences
      .unsubscribe(u, c, t)
      .catch(() => ({ ok: false }));
    // In the language of the person the link was made for (§308).
    const l = result.locale ?? DEFAULT_LOCALE;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const [title, words] = result.ok
      ? [
          say(l, 'Done — no more of those emails'),
          esc(
            say(
              l,
              'We will not email you about {kind}. You will still see it in the app. You can turn the emails back on any time under Notifications.',
              { kind: (result.title ?? say(l, 'that')).toLocaleLowerCase(DATE_TAGS[l]) },
            ),
          ),
        ]
      : [
          say(l, 'That link did not work'),
          say(l, 'It may be old or cut short. Change what we send in the app, under Notifications.'),
        ];
    return (
      `<!doctype html><html lang="${l}"><head><meta charset="utf-8">` +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<title>${title}</title></head>` +
      '<body style="margin:0;background:#F6F4F0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15171C">' +
      '<div style="max-width:420px;margin:12vh auto;padding:28px;background:#fff;border-radius:22px;text-align:center">' +
      `<h1 style="font-size:22px;margin:0 0 10px">${title}</h1>` +
      `<p style="font-size:15px;line-height:1.5;color:#4B505B;margin:0">${words}</p>` +
      '</div></body></html>'
    );
  }
}
