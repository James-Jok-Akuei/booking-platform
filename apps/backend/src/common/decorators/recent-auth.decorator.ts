import { applyDecorators, UseGuards } from '@nestjs/common';
import { RecentAuthGuard } from '../../auth/guards/recent-auth.guard';

/** This change needs a code typed in the last few minutes (§279). */
export const RecentAuth = () => applyDecorators(UseGuards(RecentAuthGuard));
