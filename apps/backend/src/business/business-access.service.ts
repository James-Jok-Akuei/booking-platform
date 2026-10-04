import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessMemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ownership boundary for every business-owned resource.
 *
 * The rule: a person can only ever read or write the data of the business they
 * are an ACTIVE member of. That is enforced structurally rather than by a
 * permission check that could be forgotten — every service resolves the
 * caller's own `businessId` here first and then scopes its queries by it, so a
 * request for another business's location or service simply matches no row.
 * There is no code path that loads a resource by id alone and then asks whether
 * the caller owns it.
 *
 * Membership replaced the old direct `BusinessProfile.userId` link. Everything
 * that used to mean "the user who owns this business" now means "any active
 * member of this business", and the OWNER/MANAGER/STAFF distinction is layered
 * on top by BusinessRolesGuard rather than being baked in here.
 */
@Injectable()
export class BusinessAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's ACTIVE membership — the single definition of "which business
   * is this person in, and as what".
   *
   * REMOVED memberships are deliberately excluded: the row survives as a record
   * that someone once had access, but it grants nothing.
   */
  async requireActiveMembership(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: { userId, status: BusinessMemberStatus.ACTIVE },
      select: { id: true, businessProfileId: true, role: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'This account is not an active member of any business.',
      );
    }

    return membership;
  }

  /**
   * The caller's business id.
   *
   * Kept as the entry point every feature service already calls, so the switch
   * from the 1:1 relation to memberships did not have to touch each of them.
   */
  async requireBusinessId(userId: string): Promise<string> {
    const membership = await this.requireActiveMembership(userId);
    return membership.businessProfileId;
  }

  /** True when the user is an active member of that specific business. */
  async isActiveMember(userId: string, businessProfileId: string): Promise<boolean> {
    const count = await this.prisma.businessMembership.count({
      where: { userId, businessProfileId, status: BusinessMemberStatus.ACTIVE },
    });
    return count > 0;
  }

  /**
   * Loads a location *and* proves it belongs to this business in one query.
   *
   * Returns 404 rather than 403 for another business's location: confirming
   * that an id exists but belongs to a competitor is itself a small
   * information leak.
   */
  async requireOwnedLocation(businessId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId },
    });

    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    return location;
  }

  /**
   * The same check for a service, and for the same reason (§132.1).
   *
   * Lived privately on `ServicesService` until service photos needed it too.
   * Two copies of an ownership check is the §128.5 mistake applied to a
   * predicate rather than to a `select` — and the one that leaks is always the
   * copy nobody remembered to change.
   */
  async requireOwnedService(businessId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      select: { id: true },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }
}
