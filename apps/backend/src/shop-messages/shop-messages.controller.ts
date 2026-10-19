import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { BusinessMemberRole, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BusinessRoles } from '../common/decorators/business-roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { BusinessRolesGuard } from '../business/guards/business-roles.guard';
import { ShopMessagesService } from './shop-messages.service';
import { FollowListDto, FollowStateDto, SendShopMessageDto, ShopMessagesDto } from './dto/shop-message.dto';

/** The shops a customer follows (§287). */
@Controller('follows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@ApiErrors({ auth: true, roles: true, notFound: true })
export class FollowsController {
  constructor(private readonly shopMessages: ShopMessagesService) {}

  @Get()
  @ApiOkResponse({ type: FollowListDto })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.shopMessages.follows(user.userId);
  }

  /** Following is the yes to that shop's offers, kept with its words. */
  @Post(':businessId')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FollowStateDto })
  follow(@CurrentUser() user: AuthenticatedUser, @Param('businessId', ParseUUIDPipe) businessId: string) {
    return this.shopMessages.follow(user.userId, businessId);
  }

  @Delete(':businessId')
  @ApiOkResponse({ type: FollowStateDto })
  unfollow(@CurrentUser() user: AuthenticatedUser, @Param('businessId', ParseUUIDPipe) businessId: string) {
    return this.shopMessages.unfollow(user.userId, businessId);
  }
}

/** A shop writing to its followers (§287). */
@Controller('business/shop-messages')
@UseGuards(JwtAuthGuard, RolesGuard, BusinessRolesGuard)
@Roles(UserRole.BUSINESS)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class BusinessShopMessagesController {
  constructor(private readonly shopMessages: ShopMessagesService) {}

  @Get()
  @ApiOkResponse({ type: ShopMessagesDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER, BusinessMemberRole.STAFF)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.shopMessages.listForShop(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ShopMessagesDto })
  @BusinessRoles(BusinessMemberRole.OWNER, BusinessMemberRole.MANAGER)
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendShopMessageDto) {
    return this.shopMessages.send(user.userId, dto);
  }
}
