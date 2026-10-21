# 개발 인계

기준: 2026-10-12. 저장소 https://github.com/nyoungeeee/dance_is_not_a_crime
운영: https://dance-is-not-a-crime.b201.kr (b201 서버, Cloudflare Tunnel → localhost:3220)

## 현재 상태

- 카카오 로그인·세션·닉네임·로그아웃·탈퇴, 주문(제출·수정·수령일·입금 확인 요청·취소), 문의 대화, 운영자 화면(/admin: 입금 대조·상태 변경·발주 집계·CSV·문의 답변)을 `server/`(NestJS + Prisma 7 + SQLite)로 구현했다.
- `server/test/api.test.ts`(모의 로그인)로 서버 규칙을, WebKit 브라우저로 사용자·운영자 전체 흐름(모바일 폭)을 확인했다.
- 실제 카카오 키로 로그인하는 흐름은 서버 `.env`에 키를 넣은 뒤 운영 주소에서 확인해야 한다.

## 남은 작업

- 운영 `.env` 작성(카카오 키, SESSION_SECRET, ADMIN_KAKAO_IDS) 후 실제 카카오 로그인 확인
- 현장 수령: `/admin#pickup` 탭으로 처리(README 운영 절). 행사 전날 날짜별 인쇄용 명단을 뽑아 둔다.
- 주문 기록 보관 기간과 탈퇴 후 처리 기준 확정(현재: 주문 기록은 닉네임 없이 보관)
- 2차(세종) 공동구매 진행 중: 10/25(일) 22:00 마감 → 10/26(월) 발주 → 10/31·11/1 수령. 1차 미수령분은 주문 탭 '1차 경기' 필터에서 '수령 변경'으로 세종 날짜로 옮긴다.
- 업체 상품 도착일은 화면에 '10/30(금)까지 예정'으로 적었다. 업체 일정이 확정되면 `index.html`·`dist/group-buy.mjs`(`goodsArrivalLabel`)를 고친다.
- 자동 배포를 쓰려면 배포 키·GitHub Secrets·`DEPLOY_ENABLED` 설정(README 배포 절)

## 구현 세부

- 화면은 순수 HTML/CSS/JS, ES modules(빌드 없음). 자산 경로가 `/styles.css`, `/assets/...` 등 절대 경로라 서버가 `dist/`를 루트로 제공한다.
- 음악 BPM은 음원 분석으로 추정한 고정값: Uptown Jam 116, Bumpin 114, Shake It 127, Waiting for Sunshine 122, Rhythm Rocket 120.
- `skeletons.js`는 해골 8개(패턴 면), 4개(문구 면), 글자 8개를 원본 좌표로 나누고 CSS 배경 이미지를 사용한다.
- '아'와 '니'가 겹쳐 잘리던 문제를 실제 획 경계로 수정했다. 이 좌표를 임의로 넓히지 않는다.
- HTML과 module import의 `?v=` 값은 파일별로 다를 수 있다. 현재 포함된 소스와 그대로 대응하며, 수정한 파일은 관련 URL 버전을 갱신한다.
