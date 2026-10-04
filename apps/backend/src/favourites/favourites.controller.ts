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
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ApiOkResponse } from '@nestjs/swagger';
import { FavouritesService } from './favourites.service';
import {
  FavouriteStateDto,
  SavedPlacePageDto,
} from './dto/favourite-response.dto';
import { SaveFavouriteDto } from './dto/save-favourite.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';

/**
 * Places a customer saved to come back to (§120).
 *
 * CUSTOMER only. A business saving shops is not a thing this platform does, and
 * leaving it open would mean one more surface to reason about for no use.
 */
@Controller('favourites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@ApiErrors({ auth: true, roles: true, validation: true, notFound: true })
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  @ApiOkResponse({ type: SavedPlacePageDto })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.favourites.list(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FavouriteStateDto })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveFavouriteDto) {
    return this.favourites.add(user.userId, dto.locationId);
  }

  /**
   * Keyed by LOCATION, not by the favourite's own id: the client has the
   * location in hand and would otherwise have to look up a row id to delete one.
   */
  @Delete(':locationId')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FavouriteStateDto })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.favourites.remove(user.userId, locationId);
  }
}
