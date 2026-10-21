// 공동구매 차수(server/src/common/group-buy.ts ROUNDS와 같은 값). 주문 마감·수정·즉시 취소는 그 주문이 속한 차수를 따른다.
export const ROUNDS = Object.freeze({
  1: Object.freeze({
    ordersCloseAt: '2026-10-13T22:00:00+09:00', ordersCloseLabel: '10/13(화) 22:00',
    paymentDeadline: '2026-10-13T23:59:59.999+09:00', paymentDeadlineLabel: '10/13(화) 23:59',
    supplierOrderLabel: '10/14(수) 오전', goodsArrivalLabel: '10/16(금) 예정', events: Object.freeze(['inmufe']),
  }),
  2: Object.freeze({
    ordersCloseAt: '2026-10-25T22:00:00+09:00', ordersCloseLabel: '10/25(일) 22:00',
    paymentDeadline: '2026-10-25T23:59:59.999+09:00', paymentDeadlineLabel: '10/25(일) 23:59',
    supplierOrderLabel: '10/26(월)', goodsArrivalLabel: '10/30(금)까지 예정', events: Object.freeze(['sejong']),
  }),
});
// 지금 주문을 받는 차수. 이 화면의 새 주문서·카운트다운·안내 문구는 이 차수 기준이다.
export const CURRENT_ROUND = 2;
export const GROUP_BUY = Object.freeze({
  round: CURRENT_ROUND,
  ...ROUNDS[CURRENT_ROUND],
  unitPrice: 5300,
  // 공동구매 진행 조건: 차수별 전체 주문 수량이 이만큼 모이지 않으면 취소하고 전액 환불
  minTotalQuantity: 50,
  minQuantity: 1,
  maxQuantity: 20,
  bankAccount: Object.freeze({bank: '토스뱅크', number: '1002-8046-9572', holder: '조현영'}),
  // 현장 배부 공지. index.html의 링크와 같은 주소
  openChatUrl: 'https://open.kakao.com/o/g384C4Ri',
  // 1차 미수령 안내(세종 수령·기부)를 띄우는 마지막 시각: 세종보헤미안뮤직페스티벌 마지막 날 끝
  pickupNoticeUntil: '2026-11-01T23:59:59+09:00',
});
const roundOf = round => ROUNDS[round] ?? ROUNDS[CURRENT_ROUND];
/** 그 차수(기본: 지금 차수)의 주문 접수가 열려 있는지. */
export function ordersOpen(now = new Date(), round = CURRENT_ROUND) {
  const time = new Date(now).getTime();
  return Number.isFinite(time) && time < new Date(roundOf(round).ordersCloseAt).getTime();
}
export const ORDER_STATUS = Object.freeze({payment_pending:'입금 대기',verification_requested:'입금 확인 요청',paid:'입금 확인 완료',cancel_requested:'취소 확인 요청',cancelled:'취소됨',refunded:'환불 완료',picked_up:'수령 완료'});

export function paymentWindowOpen(now = new Date(), round = CURRENT_ROUND) {
  const time = new Date(now).getTime();
  return Number.isFinite(time) && time <= new Date(roundOf(round).paymentDeadline).getTime();
}

export function parseQuantity(value) {
  const raw = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(raw)) return null;
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity >= GROUP_BUY.minQuantity && quantity <= GROUP_BUY.maxQuantity ? quantity : null;
}
export function orderAmount(quantity, unitPrice = GROUP_BUY.unitPrice) {
  if (!Number.isSafeInteger(quantity) || quantity < GROUP_BUY.minQuantity || quantity > GROUP_BUY.maxQuantity || !Number.isSafeInteger(unitPrice) || unitPrice < 0) return null;
  const amount = quantity * unitPrice;
  return Number.isSafeInteger(amount) ? amount : null;
}

export function getOrderCountdown(now = new Date()) {
  const time = new Date(now).getTime();
  const remaining = Number.isFinite(time) ? Math.max(0,new Date(GROUP_BUY.ordersCloseAt).getTime() - time) : 0;
  const totalSeconds = Math.ceil(remaining / 1000);
  return {days:Math.floor(totalSeconds / 86400),hours:Math.floor(totalSeconds % 86400 / 3600),minutes:Math.floor(totalSeconds % 3600 / 60),seconds:totalSeconds % 60,isClosed:totalSeconds === 0};
}
