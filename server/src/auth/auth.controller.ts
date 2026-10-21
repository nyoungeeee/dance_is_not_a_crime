import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { AppConfig, CONFIG } from '../config';
import { KakaoClient, KakaoIdentity } from './kakao.client';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

const STATE_COOKIE = 'dnc_oauth';
/** 로그인 후 이어서 열 화면. 주소 대신 정해진 값만 받는다(오픈 리다이렉트 방지). */
const INTENTS = new Set(['login', 'order', 'my', 'message', 'admin', 'notice']);

function safeIntent(v: unknown): string {
  return typeof v === 'string' && INTENTS.has(v) ? v : 'login';
}

@Controller('auth')
export class AuthController {
  private readonly log = new Logger('Auth');

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly kakao: KakaoClient,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  @Get('kakao/login')
  login(@Query('intent') intent: string, @Res() res: Response) {
    const state = crypto.randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, JSON.stringify({ state, intent: safeIntent(intent) }), {
      ...this.sessions.cookieOptions(),
      maxAge: 10 * 60 * 1000,
    });
    if (this.cfg.authMock) return res.redirect(`/api/auth/mock?state=${state}`);
    res.redirect(this.kakao.authorizeUrl(state));
  }

  @Get('kakao/callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    let saved: { state?: string; intent?: string } = {};
    try {
      saved = JSON.parse(req.cookies?.[STATE_COOKIE] ?? '{}');
    } catch {}
    res.clearCookie(STATE_COOKIE, this.sessions.cookieOptions());
    const intent = safeIntent(saved.intent);
    const back = (login: string) => res.redirect(`/?${new URLSearchParams({ login, intent })}`);

    // 사용자가 동의 화면에서 취소한 경우
    if (error) return back('cancelled');
    if (!code || !state || !saved.state || state !== saved.state) return back('error');

    let identity: KakaoIdentity;
    try {
      identity = this.cfg.authMock && code.startsWith('mock:') ? { kakaoId: `mock-${code.slice(5)}` } : await this.kakao.identify(code);
    } catch (e) {
      this.log.warn(`카카오 로그인 실패: ${(e as Error).message}`);
      return back('error');
    }

    // 기존 세션이 있었다면 교체
    await this.sessions.destroy(req, res);
    const user = await this.users.upsertByKakaoId(identity.kakaoId);
    await this.sessions.create(res, user.id);
    back(user.nickname ? 'ok' : 'new');
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res() res: Response) {
    await this.sessions.destroy(req, res);
    res.json({ ok: true });
  }

  // ---- 개발 전용 모의 로그인(AUTH_MOCK=1, 운영에서는 기동 자체가 거부됨) ----

  @Get('mock')
  mockPage(@Query('state') state: string, @Res() res: Response) {
    if (!this.cfg.authMock) return res.status(404).end();
    const s = encodeURIComponent(state ?? '');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>모의 카카오 로그인</title>
<body style="font-family:sans-serif;padding:24px;max-width:360px;margin:auto">
<h3>모의 카카오 로그인 (개발용)</h3>
<form action="/api/auth/mock/go" method="get">
<input type="hidden" name="state" value="${s}">
<p><label>카카오 회원번호 <input name="kid" value="1001" required></label></p>
<button>로그인</button></form>
<p><a href="/api/auth/kakao/callback?error=access_denied&state=${s}">동의 취소 흉내</a></p></body>`);
  }

  @Get('mock/go')
  mockGo(@Query('state') state: string, @Query('kid') kid: string, @Res() res: Response) {
    if (!this.cfg.authMock) return res.status(404).end();
    const code = `mock:${String(kid).replace(/[^0-9a-z]/gi, '')}`;
    res.redirect(`/api/auth/kakao/callback?${new URLSearchParams({ code, state: state ?? '' })}`);
  }
}
