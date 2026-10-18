import {
  Body,
  Controller,
  Delete,
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
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { ActionMessageDto } from '../common/dto/action-message.dto';
import { BusinessRolesGuard } from '../business/guards/business-roles.guard';
import { galleryUploadOptions } from '../business/gallery-upload.options';
import { MulterExceptionFilter } from '../business/filters/multer-exception.filter';
import { StoriesService } from './stories.service';
import { PostStoryDto, RemoveStoryDto, ReportStoryDto } from './dto/story-request.dto';
import { AdminStoriesDto, BusinessStoryDto, MyStoriesDto, StoryFeedDto } from './dto/story-response.dto';

/**
 * A shop's own stories (§285). The owner and managers post and take down;
 * everyone in the shop can see them.
 */
@Controller('business/stories')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class BusinessStoriesController {
  constructor(private readonly stories: StoriesService) {}

  /** One photo — the same kinds a shop's photos may be — and a few words. */
  @Post()
  @ApiCreatedResponse({ type: BusinessStoryDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  @UseInterceptors(FileInterceptor('file', galleryUploadOptions))
  @UseFilters(new MulterExceptionFilter({ maxFiles: 1, field: 'file', noun: 'image' }))
  post(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File, @Body() dto: PostStoryDto) {
    return this.stories.post(user.userId, file, dto);
  }

  @Get()
  @ApiOkResponse({ type: MyStoriesDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER, BusinessMemberRole.STAFF)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.stories.listMine(user.userId);
  }

  @Delete(':id')
  @ApiOkResponse({ type: ActionMessageDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.remove(user.userId, id);
  }
}

/**
 * Stories for customers (§285). Open to anyone, signed in or not: they are
 * shop windows, and they work as advertising.
 */
@Controller('stories')
@ApiErrors({ validation: true, notFound: true })
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @ApiOkResponse({ type: StoryFeedDto })
  feed() {
    return this.stories.feed();
  }

  /** Counted, never recorded against anyone. */
  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ActionMessageDto })
  async view(@Param('id', ParseUUIDPipe) id: string) {
    await this.stories.view(id);
    return { message: 'Counted.' };
  }

  /** A signed-in customer says it should not be there. */
  @Post(':id/report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ActionMessageDto })
  @ApiErrors({ auth: true, roles: true })
  report(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportStoryDto) {
    return this.stories.report(user.userId, id, dto.reason);
  }
}

/** Reported stories, and taking one down (§285). */
@Controller('admin/stories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class AdminStoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @ApiOkResponse({ type: AdminStoriesDto })
  @ApiQuery({ name: 'view', required: false, enum: ['reported', 'live'] })
  list(@Query('view') view?: string) {
    return this.stories.adminList(view === 'live' ? 'live' : 'reported');
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ActionMessageDto })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveStoryDto) {
    return this.stories.adminRemove(user.userId, id, dto.reason);
  }

  @Post(':id/keep')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ActionMessageDto })
  keep(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.adminKeep(user.userId, id);
  }
}
