import { fail } from './errors';

/** dist/group-buy.mjs, dist/account-state.mjs와 같은 값. 서버가 기준이다. */
export const GROUP_BUY = {
  ordersCloseAt: new Date('2026-10-13T22:00:00+09:00'),
  paymentDeadline: new Date('2026-10-13T23:59:59.999+09:00'),
  unitPrice: 5300,
  minQuantity: 1,
  maxQuantity: 20,
} as const;

export const EVENTS: Record<string, { available: boolean; name: string; dates: string[] }> = {
  inmufe: { available: true, name: '경기인디뮤직페스티벌', dates: ['2026-10-17', '2026-10-18'] },
  sejong: { available: false, name: '세종보헤미안뮤직페스티벌', dates: ['2026-10-30', '2026-10-31', '2026-11-01'] },
};

export const ORDER_STATUSES = [
  'payment_pending',
  'verification_requested',
  'paid',
  'cancel_requested',
  'cancelled',
  'refunded',
  'picked_up',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 끝난 주문. 이 상태의 주문만 있으면 탈퇴할 수 있다. */
export const CLOSED_STATUSES: readonly string[] = ['cancelled', 'refunded', 'picked_up'];
/** 사람당 동시에 진행할 수 있는 주문 수(장난·실수 방지). 끝난 주문은 세지 않는다. */
export const MAX_OPEN_ORDERS = 10;

export function ordersOpen(now = new Date()): boolean {
  return now.getTime() < GROUP_BUY.ordersCloseAt.getTime();
}

export interface OrderInput {
  quantity: number;
  event: string;
  pickupDate: string;
  payerName: string;
}

export function validatePickupDate(event: string, date: unknown): string {
  if (typeof date !== 'string' || !EVENTS[event]?.dates.includes(date)) fail(400, 'INVALID_PICKUP_DATE', '선택한 행사의 수령일을 골라주세요.');
  return date;
}

export function validateOrderInput(body: unknown): OrderInput {
  const v = (body ?? {}) as Record<string, unknown>;
  const quantity = v.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < GROUP_BUY.minQuantity || quantity > GROUP_BUY.maxQuantity) {
    fail(400, 'INVALID_QUANTITY', '주문 수량은 1~20개의 정수로 입력해주세요.');
  }
  const event = typeof v.event === 'string' ? v.event : '';
  if (!Object.hasOwn(EVENTS, event)) fail(400, 'INVALID_EVENT', '수령할 행사를 선택해주세요.');
  if (!EVENTS[event].available) fail(400, 'EVENT_UNAVAILABLE', '세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.');
  const pickupDate = validatePickupDate(event, v.pickupDate);
  const payerName = typeof v.payerName === 'string' ? v.payerName.trim() : '';
  if (!payerName || [...payerName].length > 40 || /[<>\u0000-\u001f]/u.test(payerName)) {
    fail(400, 'INVALID_PAYER_NAME', '입금자명을 1~40자로 입력해주세요.');
  }
  return { quantity, event, pickupDate, payerName };
}

export function validateNickname(raw: unknown): string {
  const nickname = typeof raw === 'string' ? raw.trim() : '';
  const count = [...nickname].length;
  if (count < 2 || count > 20) fail(400, 'INVALID_NICKNAME', '닉네임은 2~20자로 입력해주세요.');
  if (!/^[\p{L}\p{N}\p{M} ._-]+$/u.test(nickname)) fail(400, 'INVALID_NICKNAME', '한글·영문·숫자·공백과 . _ -만 사용할 수 있어요.');
  if (nickname.startsWith('탈퇴회원') || nickname === '운영자') fail(400, 'INVALID_NICKNAME', '사용할 수 없는 닉네임이에요.');
  return nickname;
}

export function validateMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) fail(400, 'EMPTY_MESSAGE', '메시지를 입력해주세요.');
  if ([...text].length > 500) fail(400, 'MESSAGE_TOO_LONG', '메시지는 500자 이내로 입력해주세요.');
  return text;
}
