import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: 'BUSINESS' | 'CUSTOMER' | 'ADMIN';
}

// Returns undefined on routes guarded by OptionalJwtAuthGuard when the caller
// is anonymous. On JwtAuthGuard-protected routes it is always populated — the
// guard rejects the request otherwise — so those handlers can keep annotating
// it as AuthenticatedUser without a null check.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
