import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { fail } from '../common/errors';
import { SessionService, SessionUser } from './session.service';

type AuthedRequest = Request & { user?: SessionUser };

/** 카카오 로그인한 계정만 허용. 닉네임이 필요한 기능은 requireNickname으로 따로 확인한다. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.sessions.resolve(req);
    if (!user) fail(401, 'LOGIN_REQUIRED', '로그인이 필요해요.');
    req.user = user;
    return true;
  }
}

/** 운영자: 서버 설정(ADMIN_KAKAO_IDS)에 있는 카카오 계정만. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.sessions.resolve(req);
    if (!user) fail(401, 'LOGIN_REQUIRED', '로그인이 필요해요.');
    if (!user.isAdmin) fail(403, 'FORBIDDEN', '운영자만 볼 수 있어요.');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});

/** 주문·문의는 닉네임이 있어야 한다. */
export function requireNickname(user: SessionUser): string {
  if (!user.nickname) fail(403, 'NICKNAME_REQUIRED', '닉네임을 먼저 설정해주세요.');
  return user.nickname;
}
