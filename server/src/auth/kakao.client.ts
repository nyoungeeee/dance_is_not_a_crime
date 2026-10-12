import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';

export interface KakaoIdentity {
  kakaoId: string;
}

/**
 * 카카오 OAuth. 토큰은 회원번호 조회에만 쓰고 저장하지 않는다.
 * 동의항목은 요청하지 않는다(기본 정보인 회원번호만 사용).
 */
@Injectable()
export class KakaoClient {
  private readonly log = new Logger('Kakao');

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  authorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.cfg.kakao.restApiKey,
      redirect_uri: this.cfg.kakao.redirectUri,
      response_type: 'code',
      state,
    });
    return `https://kauth.kakao.com/oauth/authorize?${p}`;
  }

  async identify(code: string): Promise<KakaoIdentity> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.cfg.kakao.restApiKey,
      redirect_uri: this.cfg.kakao.redirectUri,
      code,
    });
    if (this.cfg.kakao.clientSecret) body.set('client_secret', this.cfg.kakao.clientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`kakao token ${tokenRes.status} ${await kakaoError(tokenRes)}`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!meRes.ok) throw new Error(`kakao user/me ${meRes.status} ${await kakaoError(meRes)}`);
    const me = (await meRes.json()) as { id: number };
    return { kakaoId: String(me.id) };
  }

  /** 앱 연결 해제(탈퇴). 저장된 토큰이 없으므로 Admin 키로 처리한다. */
  async unlink(kakaoId: string): Promise<boolean> {
    if (!this.cfg.kakao.adminKey) {
      this.log.warn('KAKAO_ADMIN_KEY 미설정: 카카오 연결 해제를 건너뜀');
      return false;
    }
    try {
      const res = await fetch('https://kapi.kakao.com/v1/user/unlink', {
        method: 'POST',
        headers: {
          Authorization: `KakaoAK ${this.cfg.kakao.adminKey}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: new URLSearchParams({ target_id_type: 'user_id', target_id: kakaoId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) this.log.warn(`카카오 연결 해제 실패 status=${res.status}`);
      return res.ok;
    } catch (e) {
      this.log.warn(`카카오 연결 해제 요청 오류: ${(e as Error).message}`);
      return false;
    }
  }
}

/** 카카오 오류 응답에서 원인 코드만 뽑는다(예: KOE006 = redirect_uri 불일치, KOE010 = client_secret 불일치). */
async function kakaoError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; error_code?: string; error_description?: string; code?: number; msg?: string };
    return [j.error_code, j.error, j.error_description, j.code, j.msg].filter((x) => x !== undefined && x !== '').join(' ');
  } catch {
    return '';
  }
}
