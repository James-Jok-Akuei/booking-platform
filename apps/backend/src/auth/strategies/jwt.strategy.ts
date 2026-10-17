import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: 'BUSINESS' | 'CUSTOMER' | 'ADMIN';
  /**
   * When the code was typed that began this sign-in, in seconds (§279) — the
   * standard `auth_time` claim. Carried through every refresh unchanged. Absent
   * on tokens from before it existed, which then count as not recent.
   */
  auth_time?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  // Whatever we return here becomes `request.user`.
  async validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email, role: payload.role, authTime: payload.auth_time ?? null };
  }
}
