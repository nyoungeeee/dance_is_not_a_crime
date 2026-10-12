import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { AppConfig, CONFIG } from '../config';
import { PrismaService } from '../prisma.service';

export const SESSION_COOKIE = 'dnc_sid';

export interface SessionUser {
  id: number;
  nickname: string | null;
  isAdmin: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string): string {
    return crypto.createHmac('sha256', this.cfg.sessionSecret).update(token).digest('hex');
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.cfg.publicUrl.startsWith('https://'),
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  isAdmin(kakaoId: string | null): boolean {
    return !!kakaoId && this.cfg.adminKakaoIds.has(kakaoId);
  }

  async create(res: Response, userId: number) {
    const token = crypto.randomBytes(32).toString('base64url');
    const maxAge = this.cfg.sessionDays * 24 * 60 * 60 * 1000;
    await this.prisma.session.create({
      data: { tokenHash: this.hash(token), userId, expiresAt: new Date(Date.now() + maxAge) },
    });
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge });
  }

  /** 쿠키의 세션을 매 요청 DB에서 검증한다. 만료·탈퇴 계정이면 null. 운영자 여부도 매번 설정값으로 다시 판단. */
  async resolve(req: Request): Promise<SessionUser | null> {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || session.user.withdrawnAt) return null;
    const { user } = session;
    return { id: user.id, nickname: user.nickname, isAdmin: this.isAdmin(user.kakaoId) };
  }

  async destroy(req: Request, res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) {
      await this.prisma.session.deleteMany({ where: { tokenHash: this.hash(token) } });
    }
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  async purgeExpired() {
    await this.prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }
}
