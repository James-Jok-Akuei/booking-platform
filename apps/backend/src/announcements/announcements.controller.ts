import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { AnnouncementsService } from './announcements.service';
import { BannerQueryDto, SaveAnnouncementDto, SendAnnouncementDto } from './dto/announcement-request.dto';
import { RequestLocale } from '../i18n/request-locale.decorator';
import type { Locale } from '../i18n/locales';
import {
  AnnouncementDto,
  AnnouncementListDto,
  AnnouncementReachDto,
  BannersDto,
} from './dto/announcement-response.dto';

/** Writing to many people at once (§287). Administrators only. */
@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @ApiOkResponse({ type: AnnouncementListDto })
  list() {
    return this.announcements.list();
  }

  /** How many a draft would reach, and how — asked as it is being written. */
  @Post('reach')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AnnouncementReachDto })
  reach(@Body() dto: SaveAnnouncementDto) {
    return this.announcements.reach(dto);
  }

  @Post()
  @ApiCreatedResponse({ type: AnnouncementDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveAnnouncementDto) {
    return this.announcements.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: AnnouncementDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AnnouncementDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAnnouncementDto) {
    return this.announcements.update(id, dto);
  }

  /** The same message to the administrator alone. */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ActionMessageDto })
  test(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.test(user.userId, id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AnnouncementDto })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAnnouncementDto,
  ) {
    return this.announcements.send(user.userId, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AnnouncementDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.cancel(id);
  }
}

/**
 * Service notices across the top of an app (§287). Open to anyone: the
 * customer app shows them before sign-in too.
 */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('banner')
  @ApiOkResponse({ type: BannersDto })
  @ApiErrors({ validation: true })
  banner(@Query() query: BannerQueryDto, @RequestLocale() locale: Locale) {
    return this.announcements.banners(query.for, locale);
  }
}
