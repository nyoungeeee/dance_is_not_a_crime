import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config';
import { SessionService } from './auth/session.service';

// 로컬 개발용 환경변수 파일(있을 때만). 이미 설정된 값은 덮어쓰지 않으므로 먼저 읽은 파일이 우선한다.
//   .env.local  카카오 키 등 비밀값(git에 올리지 않음)
//   .env        개발 설정
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

/** 쓰기 요청에 붙이는 헤더. 다른 사이트의 form/fetch가 흉내 낼 수 없다(CSRF 차단). */
export const CSRF_HEADER = 'x-dance';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  const cfg = app.get<AppConfig>(CONFIG);
  const log = new Logger('Http');

  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Cloudflare에 http로 들어온 요청은 https 주소로 보낸다. 주소는 PUBLIC_URL로 고정(Host 헤더를 믿지 않음).
  if (cfg.production && cfg.publicUrl.startsWith('https://')) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.get('x-forwarded-proto') !== 'http') return next();
      res.redirect(308, cfg.publicUrl + req.originalUrl);
    });
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: cfg.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());

  // 컨테이너 헬스체크(배포 스크립트·CI가 사용)
  app.use('/healthz', (_req: Request, res: Response) => res.type('text').send('ok\n'));

  // API: 캐시 금지 + 쓰기 요청은 커스텀 헤더/Origin으로 CSRF 차단. 로그에는 쿼리스트링(OAuth code 등)을 남기지 않는다.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 500) log.error(`${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${Date.now() - started}ms`);
    });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get(CSRF_HEADER) !== '1' || (origin && origin !== cfg.publicUrl)) {
        return res.status(403).json({ code: 'CSRF', message: '잘못된 요청이에요.' });
      }
    }
    next();
  });

  app.setGlobalPrefix('api');

  // 정적 화면(dist/). HTML은 매번 확인하고, 나머지는 ?v= 버전으로 갱신한다.
  if (fs.existsSync(path.join(cfg.webDist, 'index.html'))) {
    app.useStaticAssets(cfg.webDist, {
      extensions: ['html'],
      maxAge: '1h',
      setHeaders: (res, file) => {
        if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    });
  } else {
    new Logger('Bootstrap').warn(`화면 파일 없음(${cfg.webDist}) — API만 제공`);
  }

  app.enableShutdownHooks();
  return { app, cfg };
}

async function bootstrap() {
  const { app, cfg } = await createApp();
  await app.listen(cfg.port, '0.0.0.0');
  const boot = new Logger('Bootstrap');
  boot.log(`listening :${cfg.port} (${cfg.production ? 'production' : 'dev'}${cfg.authMock ? ', AUTH_MOCK' : ''})`);
  if (!cfg.authMock) {
    if (!cfg.kakao.restApiKey) boot.warn('KAKAO_REST_API_KEY 없음: 카카오 로그인이 실패한다');
    else boot.log(`카카오 로그인 redirect_uri=${cfg.kakao.redirectUri}`);
  }
  if (!cfg.adminKakaoIds.size) boot.warn('ADMIN_KAKAO_IDS 없음: 운영자 화면에 들어갈 수 있는 계정이 없다');
  // 만료 세션 정리(하루 한 번)
  const sessions = app.get(SessionService);
  setInterval(() => sessions.purgeExpired().catch(() => {}), 24 * 60 * 60 * 1000).unref();
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
