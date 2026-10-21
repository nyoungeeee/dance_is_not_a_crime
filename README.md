# 춤은 불법이 아니다 — 슬로건 공동구매

주문 페이지(`dist/`, 순수 HTML/CSS/JS ES modules)와 카카오 로그인·주문·문의·운영자 API 서버(`server/`, NestJS + Prisma + SQLite)입니다. 서버가 `/api`와 `dist/` 정적 화면을 한 컨테이너에서 함께 제공합니다.

운영: https://dance-is-not-a-crime.b201.kr

## 구조

```
dist/                 화면(빌드 없음). 서버가 그대로 제공
  index.html          주문 페이지
  app.js              계정·주문·문의 화면 동작. 상태는 /api/me 기준
  api.mjs             API 호출(쓰기 요청에 x-dance: 1 헤더)
  admin.html/js/css   운영자 화면(/admin). 권한은 서버가 검사
  group-buy.mjs       가격·마감·계좌·상태 라벨(화면 표시용)
  account-state.mjs   행사·수령일·닉네임·주문 입력 검증(화면 안내용)
  music.js, skeletons.js, styles.css, assets/
server/               NestJS + Prisma 7(SQLite, better-sqlite3 어댑터)
  prisma/schema.prisma  User, Session, Order, OrderLog, Message
  src/common/group-buy.ts  마감·가격·수량·행사 규칙(서버가 기준)
  src/auth/            카카오 OAuth, 세션, 권한(AuthGuard/AdminGuard)
  src/orders/ src/messages/ src/me/ src/admin/
  test/api.test.ts     모의 로그인으로 전체 흐름 검사
brand/                카카오 앱 아이콘
```

## 로컬 실행

```sh
cd server
npm ci
npm run migrate                      # server/.data/dance.db 생성
AUTH_MOCK=1 ADMIN_KAKAO_IDS=mock-9999 PORT=3000 PUBLIC_URL=http://localhost:3000 npm run dev
```

http://localhost:3000 을 엽니다. `AUTH_MOCK=1`이면 카카오 대신 모의 로그인 화면이 나오고, 카카오 회원번호를 직접 입력합니다(`9999`로 로그인하면 운영자). 운영(`NODE_ENV=production`)에서는 `AUTH_MOCK`이 거부됩니다.

실제 카카오로 로컬 테스트하려면 `server/.env.local`에 `KAKAO_REST_API_KEY` 등을 넣고(`AUTH_MOCK` 없이), Kakao Developers Redirect URI에 `http://localhost:3000/api/auth/kakao/callback`을 등록합니다.

테스트: `cd server && npm test`

## 서버 규칙

- 카카오에서는 회원번호(`id`)만 받는다. 동의항목 없음. 토큰은 저장하지 않는다.
- 세션: 쿠키(`dnc_sid`, httpOnly)에는 무작위 토큰, DB에는 HMAC 해시. 14일. 매 요청 DB에서 확인하고 탈퇴 계정은 거부.
- 쓰기 요청은 `x-dance: 1` 헤더 + Origin이 `PUBLIC_URL`인지 확인(CSRF 차단).
- 차수(`ROUNDS`, `Order.round`): 1차 경기인디뮤직페스티벌(10/13 22:00 마감, 10/17·10/18 수령), 2차 세종보헤미안뮤직페스티벌(10/25 22:00 마감·23:59 입금, 10/26 발주, 10/31·11/1 수령). 새 주문은 마감 전인 첫 차수로 들어가고 그 차수의 행사만 고를 수 있다. 주문 수정·즉시 취소·수령일 변경은 그 주문이 속한 차수의 마감을 따른다(1차 주문은 2차가 열려 있어도 마감).
- 주문: 마감·수량(1~20)·가격(5,300원, 원가)·행사·수령일·입금자명을 서버에서 검사. 2차는 수령 안내(수령 시간·미수령 시 택배·환불 불가·기부·나눔) 동의(`pickupTermsAgreed: true`)가 없으면 400. 다음 청원 참여 동의(`petitionPledged: true`)도 필수. 동의는 첫 주문 기록에 '주문서 제출 · 수령 안내 동의 · 다음 청원 참여 동의'로 남고, 운영자 주문 탭에 동의 인원이 나온다. 클라이언트가 보낸 가격·상태는 무시. 한 사람이 여러 건 주문할 수 있다(진행 중 10건까지). 주문서마다 `requestKey`를 보내 같은 주문서가 두 번 제출돼도 주문은 하나만 생긴다.
- 상태: `payment_pending`(입금 대기) → 사용자 `verification_requested`(입금 확인 요청) → 운영자 `paid`(입금 확인 완료) → `picked_up`(수령 완료). 취소는 마감 전 입금 대기면 즉시 `cancelled`, 그 외에는 `cancel_requested` → 운영자가 `cancelled`/`refunded`.
- 수령 변경(`POST /api/admin/orders/:id/pickup`, 주문 탭 '수령 변경'): 운영자가 행사·수령일을 바꾼다. 1차 경기 미수령분을 문의로 받은 세종 날짜로 옮길 때 쓴다. 차수·수량·금액·상태는 그대로, 취소·환불·수령 완료 주문은 거절, 변경 전후가 `OrderLog`에 남는다. 화면에서는 '1차 이월'로 표시하고 현장 수령 카드·인쇄 명단에도 1차 표시가 붙는다.
- 1차 미수령 안내(진입 공지): 아직 경기 수령일로 남은 입금 확인 주문이 있는 로그인 사용자에게만 자동으로 뜬다. 그 밖의 방문자는 제작·수령 안내의 '1차 경기 미수령분 안내'로 연다.
- 사용자의 입금 확인 요청만으로는 확정되지 않는다. `paid`는 운영자만 바꿀 수 있다. 모든 상태 변경은 `OrderLog`에 남는다.
- 문의: 500자, 10분에 20개 제한. 운영자가 열면 사용자 메시지 읽음, 사용자가 열면 답변 읽음.
- 운영자: `ADMIN_KAKAO_IDS`에 있는 카카오 회원번호만. 화면의 버튼이나 클라이언트 값으로 권한을 주지 않는다.
- 현장 수령(`/admin#pickup`, 노트북 기준 2열: 왼쪽 검색·후보, 오른쪽 카드 한 장. 900px 이하는 1열): 주문번호 끝 4자리·입금자명·닉네임으로 찾는다. 끝 4자리·입금자명이 정확히 맞으면 그 사람 카드 하나만, 부분 일치로 여러 명이면 후보 목록에서 골라야 카드가 뜬다(자동 선택 없음, 한 번에 한 사람). 검색창에서 `↑↓` 후보 고르기, `Enter` 전달 완료(카드가 떠 있을 때만), `Esc` 지우기. 카드는 닉네임을 크게, 입금자명을 작게 보여 주고 그 사람의 주문이 모두 묶여 나온다. 데스크톱에서는 카드 크기가 고정이고 가운데에 닉네임·수령일·총 개수를 크게 띄운다(폰은 이 큰 정보를 숨기고 주문 줄 중심). `N개 전달 완료` 버튼은 입금 확인 완료(`paid`) 주문만 `picked_up`으로 바꾼다(`POST /api/admin/pickup`, 하나라도 `paid`가 아니면 409로 아무것도 안 바뀜, 폰 두 대가 동시에 눌러도 한 번만 처리). 입금 미확인 주문은 전달 금지로 표시하고, 이미 받아 간 사람은 수령 시각을 크게 띄운다. 수령일이 오늘이 아니면 경고만 한다. 누른 뒤 10초 동안 되돌리기(`POST /api/admin/pickup/undo`, `picked_up → paid`). 인터넷이 끊길 때를 대비해 날짜별 인쇄용 명단(체크·닉네임·입금자명·수량·비고, 수량 많은 순 → 닉네임 순, 한 사람 한 줄, 수량이 바뀌는 줄에 두 줄 선, 입금 미확인은 아래 따로 회색 표)을 미리 뽑아 간다.
- 정산(`/admin` 정산 탭, `LedgerEntry`): 주문 입금은 `paid`·`picked_up` 주문에서 자동 합산하고, 업체 결제·운영자 개인 자금 투입·돌려받음·기타 수입/지출만 직접 적는다. 잔액(계산) = 주문 입금 + 개인 자금 + 기타 수입 − 업체 결제 − 돌려받음 − 기타 지출. 지운 내역은 `deletedAt`만 채워 남긴다.
- 탈퇴: 진행 중 주문(취소·환불·수령 완료 이외)이 있으면 거부. 카카오 회원번호 삭제, 닉네임 `탈퇴회원_N`, 문의 대화·세션 삭제, 카카오 연결 해제(Admin 키). 주문 기록은 입금 대조·환불 확인용으로 보관.

## Kakao Developers 설정

1. 플랫폼 → Web 사이트 도메인: `https://dance-is-not-a-crime.b201.kr`
2. 카카오 로그인 활성화, Redirect URI: `https://dance-is-not-a-crime.b201.kr/api/auth/kakao/callback`
3. 동의항목: 아무것도 켜지 않는다.
4. 보안 → Client Secret 사용 시 `KAKAO_CLIENT_SECRET`
5. 앱 키 → REST API 키 `KAKAO_REST_API_KEY`, Admin 키 `KAKAO_ADMIN_KEY`

로그인 실패 시 서버 로그의 `카카오 로그인 실패: ... KOE???`를 본다. KOE006 Redirect URI 불일치, KOE101 REST API 키 오류, KOE010 Client Secret 불일치.

## 운영자 등록

1. 운영자가 사이트에서 카카오 로그인한다.
2. 같은 브라우저로 `https://dance-is-not-a-crime.b201.kr/api/me/kakao-id` 를 열어 `kakaoId`를 확인한다.
3. 서버 `~/dance/.env`의 `ADMIN_KAKAO_IDS`에 넣고(쉼표로 여러 명) `docker compose up -d`로 다시 띄운다.
4. 계정 메뉴에 "운영자 화면"이 생기고 `/admin`에서 입금 대조·상태 변경·발주 집계·CSV·문의 답변을 한다.

## 배포 (한입팟과 같은 b201 서버, 별도 Compose 프로젝트)

```bash
cd ~/dance
cp .env.example .env      # PUBLIC_URL, SESSION_SECRET(openssl rand -hex 32), 카카오 키, ADMIN_KAKAO_IDS
mkdir -p backups && docker run --rm -v "$PWD/backups":/b alpine chown 1000:1000 /b   # 컨테이너는 node(uid 1000), b201 계정은 uid 1001
docker compose up -d --build
curl -fsS http://127.0.0.1:3220/api/health
```

- 프로젝트 이름 `dance`, 볼륨 `dance_dance-data`(SQLite). 앱은 `127.0.0.1:${HOST_PORT:-3220}`에만 열린다.
- Cloudflare Tunnel `b201`의 Published application route `dance-is-not-a-crime.b201.kr` → `http://localhost:3220`.
- 컨테이너가 시작할 때마다 `prisma migrate deploy`로 DB 마이그레이션을 적용한다.
- SQLite는 writer가 하나여야 하므로 레플리카를 늘리지 않는다.
- `scripts/deploy.sh`: `.env` 확인 → 배포 전 백업 → `origin/main`으로 fast-forward → 재빌드 → `/api/health` 확인. 실패 시 직전 커밋으로 되돌린다.
- `.github/workflows/ci-cd.yml`: PR·main 푸시마다 서버 테스트와 Docker 확인. 저장소 변수 `DEPLOY_ENABLED=true`이면 main에서 `deploy` 잡이 서버의 `scripts/deploy.sh`를 실행한다. 서버 22번 포트는 외부(GitHub)에서 막혀 있어 Cloudflare Access 터널로 들어간다: Actions → `cloudflared access ssh`(서비스 토큰) → `dance-ssh.b201.kr`(Access 앱, 서비스 토큰 정책) → 서버 `localhost:22`. 배포 키는 b201 `authorized_keys`에 `restrict,command="/home/b201/dance/scripts/deploy.sh"`로 등록해 배포 말고는 아무것도 못 한다. Secrets `DEPLOY_SSH_KEY`·`CF_ACCESS_CLIENT_ID`·`CF_ACCESS_CLIENT_SECRET`, Environment `production`.

### 백업·복원

`backup` 서비스가 `BACKUP_INTERVAL_HOURS`(기본 3시간)마다 `./backups/dance-YYYYMMDD-HHMM.db`를 만들고 `integrity_check`로 검사한다. 최근 `BACKUP_KEEP`(기본 28)개만 남긴다.

```bash
docker compose exec web node dist/src/scripts/backup.js        # 즉시 백업
# 복원
docker compose stop web
docker run --rm -v dance_dance-data:/data -v "$PWD/backups":/b alpine sh -c 'cp /b/<파일> /data/dance.db && chown 1000:1000 /data/dance.db'
docker compose start web
```

## 화면 수정 시

- HTML과 module import의 `?v=` 값은 파일별로 다를 수 있다. 수정한 파일은 그 파일을 가리키는 URL의 버전을 올린다.
- 가격·마감·행사·차수를 바꾸면 `server/src/common/group-buy.ts`(`ROUNDS`, `EVENTS`)와 `dist/group-buy.mjs`(`ROUNDS`, `CURRENT_ROUND`)·`dist/account-state.mjs`를 함께 바꾸고, `index.html`의 날짜 문구도 고친다. 서버 값이 기준이다.
