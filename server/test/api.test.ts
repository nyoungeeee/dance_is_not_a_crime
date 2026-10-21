import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';

// 임시 DB에 마이그레이션을 적용한 뒤 모의 로그인 모드로 앱을 띄운다.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dance-test-'));
const PORT = 3391;
const BASE = `http://localhost:${PORT}`;
Object.assign(process.env, {
  DATA_DIR: dataDir,
  AUTH_MOCK: '1',
  ADMIN_KAKAO_IDS: 'mock-9999',
  PUBLIC_URL: BASE,
  NODE_ENV: 'test',
});
delete process.env.DATABASE_URL;

let app: NestExpressApplication;

before(async () => {
  const root = path.resolve(__dirname, '..', '..');
  execFileSync(path.join(root, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], { cwd: root, env: process.env, stdio: 'ignore' });
  // 2차 주문 마감이 지나도 CI가 돌도록 테스트 중에는 2차 마감을 미룬다. 1차(경기)는 실제처럼 마감된 상태다.
  // 마감 동작은 '마감 후' 테스트가 이 마감 시각으로 확인한다.
  const { ROUNDS } = await import('../src/common/group-buy');
  ROUNDS[1].ordersCloseAt = new Date('2099-01-01T00:00:00+09:00');
  const { createApp } = await import('../src/main');
  ({ app } = await createApp());
  app.useLogger(false);
  await app.listen(PORT);
});

after(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

class Client {
  cookies = new Map<string, string>();

  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async raw(method: string, url: string, body?: unknown, headers: Record<string, string> = { 'x-dance': '1' }) {
    const res = await fetch(BASE + url, {
      method,
      redirect: 'manual',
      headers: {
        ...headers,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.store(res);
    return res;
  }

  async json(method: string, url: string, body?: unknown) {
    const res = await this.raw(method, url, body);
    return { status: res.status, body: (await res.json()) as any };
  }

  /** 모의 카카오 로그인 → 콜백까지 따라가고 마지막 리다이렉트 주소를 돌려준다. */
  async login(kid: string, intent = 'login') {
    let res = await this.raw('GET', `/api/auth/kakao/login?intent=${intent}`);
    const state = new URL(res.headers.get('location')!, BASE).searchParams.get('state')!;
    res = await this.raw('GET', `/api/auth/mock/go?state=${state}&kid=${kid}`);
    res = await this.raw('GET', res.headers.get('location')!);
    return new URL(res.headers.get('location')!, BASE);
  }
}

const ORDER = { quantity: 3, event: 'sejong', pickupDate: '2026-10-31', payerName: '홍길동', pickupTermsAgreed: true };
const key = () => crypto.randomUUID();

test('비로그인: 계정 없음, 주문·문의 401, 헤더 없는 쓰기 요청 403', async () => {
  const c = new Client();
  assert.deepEqual((await c.json('GET', '/api/me')).body, { user: null, orders: [], unread: 0 });
  assert.equal((await c.json('POST', '/api/orders', ORDER)).status, 401);
  assert.equal((await c.json('GET', '/api/orders')).status, 401);
  assert.equal((await c.json('GET', '/api/messages')).status, 401);
  const res = await c.raw('POST', '/api/auth/logout', undefined, {});
  assert.equal(res.status, 403);
});

test('로그인 의도(intent)는 허용된 값만, 동의 취소는 cancelled로 돌아온다', async () => {
  const c = new Client();
  let res = await c.raw('GET', '/api/auth/kakao/login?intent=https://evil.example');
  const state = new URL(res.headers.get('location')!, BASE).searchParams.get('state')!;
  res = await c.raw('GET', `/api/auth/kakao/callback?error=access_denied&state=${state}`);
  const back = new URL(res.headers.get('location')!, BASE);
  assert.equal(back.origin, BASE);
  assert.equal(back.searchParams.get('login'), 'cancelled');
  assert.equal(back.searchParams.get('intent'), 'login');
  // state 불일치
  res = await c.raw('GET', '/api/auth/kakao/callback?code=mock:1&state=wrong');
  assert.equal(new URL(res.headers.get('location')!, BASE).searchParams.get('login'), 'error');
});

test('여러 건 주문: 제출·중복 제출 방지·수정·입금 확인 요청·잠금·취소·탈퇴 차단', async () => {
  const c = new Client();
  const back = await c.login('1001', 'order');
  assert.equal(back.searchParams.get('login'), 'new');
  assert.equal(back.searchParams.get('intent'), 'order');

  // 닉네임 없이 주문 불가
  assert.equal((await c.json('POST', '/api/orders', ORDER)).status, 403);
  assert.equal((await c.json('PATCH', '/api/me', { nickname: 'a' })).status, 400);
  assert.equal((await c.json('PATCH', '/api/me', { nickname: '운영자' })).status, 400);
  assert.equal((await c.json('PATCH', '/api/me', { nickname: '춤추는 해골' })).body.user.nickname, '춤추는 해골');

  // 서버 검증
  for (const bad of [
    { ...ORDER, quantity: 0 },
    { ...ORDER, quantity: 21 },
    { ...ORDER, quantity: 2.5 },
    { ...ORDER, quantity: '3' },
    { ...ORDER, event: 'inmufe', pickupDate: '2026-10-17' }, // 1차 행사는 마감
    { ...ORDER, event: 'nope' },
    { ...ORDER, pickupDate: '2026-10-30' }, // 금요일은 받지 않는다
    { ...ORDER, pickupDate: '2026-10-17' },
    { ...ORDER, payerName: ' ' },
    { ...ORDER, payerName: 'x'.repeat(41) },
    { ...ORDER, payerName: '<b>' },
    { ...ORDER, pickupTermsAgreed: undefined }, // 2차는 수령 안내 동의 필수
    { ...ORDER, pickupTermsAgreed: 'true' },
  ]) {
    assert.equal((await c.json('POST', '/api/orders', bad)).status, 400, JSON.stringify(bad));
  }

  // 클라이언트가 보낸 가격·상태는 무시된다
  const k1 = key();
  let r = await c.json('POST', '/api/orders', { ...ORDER, requestKey: k1, unitPrice: 1, totalAmount: 1, status: 'paid' });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, true);
  const first = r.body.order;
  assert.match(first.id, /^DNC-[0-9A-F]{8}$/);
  assert.equal(first.totalAmount, 15900);
  assert.equal(first.status, 'payment_pending');
  assert.equal(first.round, 2);

  // 같은 주문서를 두 번 제출(연타·재전송)해도 주문은 하나
  r = await c.json('POST', '/api/orders', { ...ORDER, requestKey: k1 });
  assert.equal(r.body.created, false);
  assert.equal(r.body.order.id, first.id);

  // 추가 주문
  r = await c.json('POST', '/api/orders', { ...ORDER, quantity: 1, pickupDate: '2026-11-01', requestKey: key() });
  assert.equal(r.body.created, true);
  const second = r.body.order;
  assert.notEqual(second.id, first.id);
  let mine = (await c.json('GET', '/api/orders')).body.orders;
  assert.deepEqual(mine.map((o: any) => o.id), [second.id, first.id]);

  // 주문별 수정
  r = await c.json('PUT', `/api/orders/${first.id}`, { ...ORDER, quantity: 5 });
  assert.equal(r.body.order.totalAmount, 26500);
  assert.equal((await c.json('GET', '/api/orders')).body.orders.find((o: any) => o.id === second.id).quantity, 1);

  r = await c.json('POST', `/api/orders/${first.id}/payment-request`);
  assert.equal(r.body.order.status, 'verification_requested');
  assert.equal((await c.json('POST', `/api/orders/${first.id}/payment-request`)).status, 409);
  // 입금 확인 요청 후에는 수정 불가, 수령일 변경은 가능
  assert.equal((await c.json('PUT', `/api/orders/${first.id}`, ORDER)).status, 409);
  r = await c.json('PATCH', `/api/orders/${first.id}/pickup-date`, { pickupDate: '2026-11-01' });
  assert.equal(r.body.order.pickupDate, '2026-11-01');

  // 다른 사람은 내 주문을 볼 수도 바꿀 수도 없다
  const other = new Client();
  await other.login('1999');
  await other.json('PATCH', '/api/me', { nickname: '남의주문' });
  assert.deepEqual((await other.json('GET', '/api/orders')).body.orders, []);
  assert.equal((await other.json('PUT', `/api/orders/${second.id}`, ORDER)).status, 404);
  assert.equal((await other.json('POST', `/api/orders/${second.id}/cancel`)).status, 404);
  assert.equal((await other.json('POST', `/api/orders/${second.id}/payment-request`)).status, 404);
  // 남이 쓴 requestKey를 재사용해도 그 주문을 받지 못한다
  assert.equal((await other.json('POST', '/api/orders', { ...ORDER, requestKey: k1 })).status, 409);

  // 진행 중 주문이 있으면 탈퇴 불가
  assert.equal((await c.json('DELETE', '/api/me')).status, 409);

  // 입금 대기 주문은 바로 취소, 입금 확인 요청 이후는 취소 요청
  assert.equal((await c.json('POST', `/api/orders/${second.id}/cancel`)).body.order.status, 'cancelled');
  assert.equal((await c.json('POST', `/api/orders/${first.id}/cancel`)).body.order.status, 'cancel_requested');
  assert.equal((await c.json('POST', `/api/orders/${first.id}/cancel`)).status, 409);

  const me = (await c.json('GET', '/api/me')).body;
  assert.equal(me.user.nickname, '춤추는 해골');
  assert.equal(me.user.isAdmin, false);
  assert.deepEqual(me.orders.map((o: any) => o.status), ['cancelled', 'cancel_requested']);
});

test('진행 중 주문은 10건까지, 끝난 주문은 세지 않는다', async () => {
  const c = new Client();
  await c.login('1500');
  await c.json('PATCH', '/api/me', { nickname: '많이사는사람' });
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push((await c.json('POST', '/api/orders', { ...ORDER, quantity: 1, requestKey: key() })).body.order.id);
  assert.equal((await c.json('POST', '/api/orders', { ...ORDER, requestKey: key() })).status, 409);
  await c.json('POST', `/api/orders/${ids[0]}/cancel`);
  assert.equal((await c.json('POST', '/api/orders', { ...ORDER, requestKey: key() })).status, 201);
});

test('마감 후에는 제출·수정·즉시 취소가 막힌다(서버 시각 기준)', async () => {
  const { OrdersService } = await import('../src/orders/orders.service');
  const orders = app.get(OrdersService);
  const c = new Client();
  await c.login('1002');
  await c.json('PATCH', '/api/me', { nickname: '마감테스트' });
  const created = (await c.json('POST', '/api/orders', ORDER)).body.order;
  const userId = (await c.json('GET', '/api/me')).body.user.id;
  const { ROUNDS } = await import('../src/common/group-buy');
  const late = new Date(ROUNDS[1].ordersCloseAt);
  await assert.rejects(orders.create(userId, '마감테스트', ORDER, late), /마감/);
  await assert.rejects(orders.update(userId, '마감테스트', created.id, ORDER, late), /마감/);
  await assert.rejects(orders.setPickupDate(userId, created.id, '2026-11-01', late));
  const cancelled = await orders.cancel(userId, created.id, late);
  assert.equal(cancelled.status, 'cancel_requested');
});

test('문의: 500자 제한, 운영자 권한, 읽음·새 답변 표시', async () => {
  const user = new Client();
  await user.login('2001', 'message');
  await user.json('PATCH', '/api/me', { nickname: '문의하는사람' });
  assert.equal((await user.json('POST', '/api/messages', { text: '가'.repeat(501) })).status, 400);
  assert.equal((await user.json('POST', '/api/messages', { text: '  ' })).status, 400);
  assert.equal((await user.json('POST', '/api/messages', { text: '가'.repeat(500) })).status, 201);
  const sent = (await user.json('POST', '/api/messages', { text: '수령 장소가 어디인가요?' })).body.message;
  assert.equal(sent.sender, 'user');
  assert.equal(sent.read, false);

  // 일반 사용자는 운영자 API 불가
  assert.equal((await user.json('GET', '/api/admin/orders')).status, 403);
  assert.equal((await user.json('GET', '/api/admin/threads')).status, 403);

  const admin = new Client();
  await admin.login('9999');
  await admin.json('PATCH', '/api/me', { nickname: '운영팀' });
  assert.equal((await admin.json('GET', '/api/me')).body.user.isAdmin, true);
  const threads = (await admin.json('GET', '/api/admin/threads')).body.threads;
  const mine = threads.find((t: any) => t.nickname === '문의하는사람');
  assert.equal(mine.unread, 2);
  const thread = (await admin.json('GET', `/api/admin/threads/${mine.userId}`)).body;
  assert.equal(thread.messages.length, 2);
  assert.equal((await admin.json('POST', `/api/admin/threads/${mine.userId}`, { text: '경기인디 현장 부스예요.' })).status, 201);

  // 사용자: 새 답변 1개, 내 메시지는 읽음
  assert.equal((await user.json('GET', '/api/me')).body.unread, 1);
  const list = (await user.json('GET', '/api/messages')).body.messages;
  assert.deepEqual(list.map((m: any) => m.sender), ['user', 'user', 'operator']);
  assert.equal(list[1].read, true);
  assert.equal((await user.json('GET', '/api/me')).body.unread, 0);
});

test('운영자 상태 변경: 기록이 남고, 입금 확정 후 사용자는 수정 불가', async () => {
  const user = new Client();
  await user.login('3001');
  await user.json('PATCH', '/api/me', { nickname: '재주문' });
  const first = (await user.json('POST', '/api/orders', ORDER)).body.order;

  const admin = new Client();
  await admin.login('9999');
  assert.equal((await admin.json('POST', `/api/admin/orders/${first.id}/status`, { status: 'nope' })).status, 400);
  let r = await admin.json('POST', `/api/admin/orders/${first.id}/status`, { status: 'paid', note: '15,900원 입금 확인' });
  assert.equal(r.body.order.status, 'paid');
  assert.equal((await user.json('GET', '/api/me')).body.orders[0].status, 'paid');
  assert.equal((await user.json('PUT', `/api/orders/${first.id}`, ORDER)).status, 409);

  r = await admin.json('POST', `/api/admin/orders/${first.id}/status`, { status: 'refunded', note: '환불 완료' });
  assert.equal(r.body.order.status, 'refunded');

  const all = (await admin.json('GET', '/api/admin/orders')).body.orders;
  const logged = all.find((o: any) => o.id === first.id);
  assert.deepEqual(logged.logs.map((l: any) => `${l.actor}:${l.toStatus}`), ['user:payment_pending', 'admin:paid', 'admin:refunded']);
  assert.equal(logged.logs[1].note, '15,900원 입금 확인');
});

test('탈퇴: 세션 무효, 대화 삭제, 주문 기록은 비식별로 남고 같은 카카오로 다시 가입하면 새 계정', async () => {
  const c = new Client();
  await c.login('4001');
  await c.json('PATCH', '/api/me', { nickname: '떠나는사람' });
  await c.json('POST', '/api/messages', { text: '안녕하세요' });
  const o = (await c.json('POST', '/api/orders', ORDER)).body.order;
  assert.equal((await c.json('POST', `/api/orders/${o.id}/cancel`)).body.order.status, 'cancelled');
  const oldId = (await c.json('GET', '/api/me')).body.user.id;
  const sid = c.cookies.get('dnc_sid')!;

  const r = await c.json('DELETE', '/api/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.kakaoUnlinked, false);
  assert.equal((await c.json('GET', '/api/me')).body.user, null);

  // 탈퇴 전 쿠키를 다시 써도 로그인되지 않는다
  const stale = new Client();
  stale.cookies.set('dnc_sid', sid);
  assert.equal((await stale.json('GET', '/api/me')).body.user, null);

  const admin = new Client();
  await admin.login('9999');
  const threads = (await admin.json('GET', '/api/admin/threads')).body.threads;
  assert.ok(!threads.some((t: any) => t.userId === oldId));

  const back = await c.login('4001');
  assert.equal(back.searchParams.get('login'), 'new');
  assert.notEqual((await c.json('GET', '/api/me')).body.user.id, oldId);
});

test('정산 장부: 운영자만, 입금 확인 주문과 업체 결제·개인 자금으로 잔액 계산, 지운 내역은 합계에서 빠짐', async () => {
  const user = new Client();
  await user.login('5001');
  await user.json('PATCH', '/api/me', { nickname: '장부손님' });
  assert.equal((await user.json('GET', '/api/admin/ledger')).status, 403);
  assert.equal((await user.json('POST', '/api/admin/ledger', { kind: 'advance', amount: 1, occurredAt: '2026-10-13T08:55:00+09:00' })).status, 403);

  const admin = new Client();
  await admin.login('9999');
  const before = (await admin.json('GET', '/api/admin/ledger')).body.summary;
  const o = (await user.json('POST', '/api/orders', ORDER)).body.order;
  await admin.json('POST', `/api/admin/orders/${o.id}/status`, { status: 'paid' });

  assert.equal((await admin.json('POST', '/api/admin/ledger', { kind: 'nope', amount: 1, occurredAt: '2026-10-13T08:55:00+09:00' })).status, 400);
  assert.equal((await admin.json('POST', '/api/admin/ledger', { kind: 'advance', amount: -5, occurredAt: '2026-10-13T08:55:00+09:00' })).status, 400);
  assert.equal((await admin.json('POST', '/api/admin/ledger', { kind: 'advance', amount: 5, occurredAt: 'x' })).status, 400);

  const vendorAmount = o.totalAmount + 10600;
  let r = await admin.json('POST', '/api/admin/ledger', { kind: 'vendor_payment', amount: vendorAmount, quantity: o.quantity + 2, memo: '1차 발주', occurredAt: '2026-10-13T08:55:00+09:00' });
  assert.equal(r.status, 201);
  r = await admin.json('POST', '/api/admin/ledger', { kind: 'advance', amount: 10600, quantity: 2, memo: '개인 자금', occurredAt: '2026-10-13T08:54:00+09:00' });
  const advanceId = r.body.entry.id;

  let s = (await admin.json('GET', '/api/admin/ledger')).body.summary;
  assert.equal(s.orderIncome.amount - before.orderIncome.amount, o.totalAmount);
  assert.equal(s.vendor.amount - before.vendor.amount, vendorAmount);
  assert.equal(s.outstandingAdvance - before.outstandingAdvance, 10600);
  assert.equal(s.balance, before.balance);
  assert.equal(s.unmatchedQuantity - before.unmatchedQuantity, 2);

  await admin.json('POST', '/api/admin/ledger', { kind: 'reimburse', amount: 5300, occurredAt: '2026-10-14T10:00:00+09:00' });
  s = (await admin.json('GET', '/api/admin/ledger')).body.summary;
  assert.equal(s.outstandingAdvance - before.outstandingAdvance, 5300);
  assert.equal(s.balance - before.balance, -5300);

  assert.equal((await admin.json('DELETE', `/api/admin/ledger/${advanceId}`)).status, 200);
  assert.equal((await admin.json('DELETE', `/api/admin/ledger/${advanceId}`)).status, 404);
  const after = (await admin.json('GET', '/api/admin/ledger')).body;
  assert.ok(!after.entries.some((e: any) => e.id === advanceId));
  assert.equal(after.summary.balance - before.balance, -15900);
});

test('현장 수령: 입금 확인 주문만 전달, 여러 건 한 번에·전부 아니면 하나도 안 바뀜, 동시 전달은 한 번만, 되돌리기', async () => {
  const user = new Client();
  await user.login('3501');
  await user.json('PATCH', '/api/me', { nickname: '수령자' });
  const a = (await user.json('POST', '/api/orders', { ...ORDER, requestKey: key() })).body.order;
  const b = (await user.json('POST', '/api/orders', { ...ORDER, quantity: 1, requestKey: key() })).body.order;
  const pending = (await user.json('POST', '/api/orders', { ...ORDER, quantity: 2, requestKey: key() })).body.order;

  assert.equal((await user.json('POST', '/api/admin/pickup', { orderIds: [a.id] })).status, 403);
  assert.equal((await user.json('POST', '/api/admin/pickup/undo', { orderIds: [a.id] })).status, 403);

  const admin = new Client();
  await admin.login('9999');
  for (const o of [a, b]) await admin.json('POST', `/api/admin/orders/${o.id}/status`, { status: 'paid' });
  const statusOf = async (id: string) => (await admin.json('GET', '/api/admin/orders')).body.orders.find((o: any) => o.id === id).status;

  assert.equal((await admin.json('POST', '/api/admin/pickup', { orderIds: [] })).status, 400);
  assert.equal((await admin.json('POST', '/api/admin/pickup', { orderIds: 'x' })).status, 400);
  assert.equal((await admin.json('POST', '/api/admin/pickup', { orderIds: ['DNC-NOPE'] })).status, 404);

  // 입금 미확인 주문이 섞이면 거절하고, 같이 보낸 입금 확인 주문도 바뀌지 않는다.
  let r = await admin.json('POST', '/api/admin/pickup', { orderIds: [a.id, pending.id] });
  assert.equal(r.status, 409);
  assert.equal(await statusOf(a.id), 'paid');
  assert.equal(await statusOf(pending.id), 'payment_pending');

  // 폰 두 대가 동시에 눌러도 한 번만 성공한다.
  const both = await Promise.all([1, 2].map(() => admin.json('POST', '/api/admin/pickup', { orderIds: [a.id, b.id] })));
  assert.deepEqual(both.map((x) => x.status).sort(), [201, 409]);
  assert.equal(await statusOf(a.id), 'picked_up');
  assert.equal(await statusOf(b.id), 'picked_up');
  assert.equal((await user.json('GET', '/api/me')).body.orders.filter((o: any) => o.status === 'picked_up').length, 2);

  // 이미 수령한 주문은 다시 전달할 수 없다.
  assert.equal((await admin.json('POST', '/api/admin/pickup', { orderIds: [a.id] })).status, 409);

  // 되돌리기: picked_up → paid만.
  assert.equal((await admin.json('POST', '/api/admin/pickup/undo', { orderIds: [pending.id] })).status, 409);
  r = await admin.json('POST', '/api/admin/pickup/undo', { orderIds: [a.id, b.id] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.orders.map((o: any) => o.status), ['paid', 'paid']);
  assert.equal((await admin.json('POST', '/api/admin/pickup/undo', { orderIds: [a.id] })).status, 409);

  const logged = (await admin.json('GET', '/api/admin/orders')).body.orders.find((o: any) => o.id === a.id);
  assert.deepEqual(logged.logs.map((l: any) => `${l.actor}:${l.toStatus}:${l.note ?? ''}`), [
    'user:payment_pending:주문서 제출 · 수령 안내 동의', 'admin:paid:', 'admin:picked_up:현장 수령', 'admin:paid:현장 수령 되돌리기',
  ]);
});

test('1차(경기) 주문: 마감된 차수라 수정·즉시 취소 불가, 운영자가 세종 수령일로 이월하면 그날 전달된다', async () => {
  const { PrismaService } = await import('../src/prisma.service');
  const prisma = app.get(PrismaService);
  const user = new Client();
  await user.login('4501');
  await user.json('PATCH', '/api/me', { nickname: '경기미수령' });
  const userId = (await user.json('GET', '/api/me')).body.user.id;
  const old = (id: string, status: string) => prisma.order.create({
    data: { id, userId, nickname: '경기미수령', quantity: 2, event: 'inmufe', pickupDate: '2026-10-18', payerName: '김경기', unitPrice: 5300, totalAmount: 10600, status, round: 1 },
  });
  const paid = await old('DNC-0000A001', 'paid');
  const pending = await old('DNC-0000A002', 'payment_pending');
  const done = await old('DNC-0000A003', 'picked_up');

  // 2차가 열려 있어도 1차 주문은 1차 마감을 따른다.
  assert.equal((await user.json('PUT', `/api/orders/${pending.id}`, ORDER)).status, 409);
  assert.equal((await user.json('PATCH', `/api/orders/${pending.id}/pickup-date`, { pickupDate: '2026-10-17' })).status, 409);
  assert.equal((await user.json('POST', `/api/orders/${pending.id}/cancel`)).body.order.status, 'cancel_requested');
  // 새 주문은 2차로 들어간다.
  const fresh = (await user.json('POST', '/api/orders', { ...ORDER, requestKey: key() })).body.order;
  assert.equal(fresh.round, 2);

  const admin = new Client();
  await admin.login('9999');
  const move = (c: Client, id: string, body: unknown) => c.json('POST', `/api/admin/orders/${id}/pickup`, body);
  assert.equal((await move(user, paid.id, { event: 'sejong', pickupDate: '2026-10-31' })).status, 403);
  assert.equal((await move(admin, 'DNC-NOPE', { event: 'sejong', pickupDate: '2026-10-31' })).status, 404);
  assert.equal((await move(admin, paid.id, { event: 'sejong', pickupDate: '2026-10-18' })).status, 400);
  assert.equal((await move(admin, paid.id, { event: 'nope', pickupDate: '2026-10-31' })).status, 400);
  assert.equal((await move(admin, done.id, { event: 'sejong', pickupDate: '2026-10-31' })).status, 409);

  const r = await move(admin, paid.id, { event: 'sejong', pickupDate: '2026-11-01', note: '문의로 일요일 수령 요청' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.order.event, r.body.order.pickupDate, r.body.order.status, r.body.order.round, r.body.order.totalAmount], ['sejong', '2026-11-01', 'paid', 1, 10600]);
  assert.equal((await move(admin, paid.id, { event: 'sejong', pickupDate: '2026-11-01' })).status, 409);
  const logged = (await admin.json('GET', '/api/admin/orders')).body.orders.find((o: any) => o.id === paid.id);
  assert.deepEqual(logged.logs.map((l: any) => l.note), ['수령 변경 경기인디뮤직페스티벌 2026-10-18 → 세종보헤미안뮤직페스티벌 2026-11-01 · 문의로 일요일 수령 요청']);
  assert.equal((await user.json('GET', '/api/me')).body.orders.find((o: any) => o.id === paid.id).pickupDate, '2026-11-01');

  // 이월한 주문도 입금 확인 완료라 그대로 전달할 수 있다.
  assert.equal((await admin.json('POST', '/api/admin/pickup', { orderIds: [paid.id] })).status, 201);
});
