export const GROUP_BUY = Object.freeze({
  ordersCloseAt: '2026-10-13T22:00:00+09:00',
  ordersCloseLabel: '10/13(화) 22:00',
  supplierOrderLabel: '10/14(수) 오전',
  goodsArrivalLabel: '10/16(금) 예정',
  unitPrice: 5000,
  minQuantity: 1,
  maxQuantity: 20,
  bankAccount: Object.freeze({bank: '토스뱅크', number: '1002-8046-9572', holder: '조현영'}),
  paymentDeadline: '2026-10-13T23:59:59.999+09:00',
  paymentDeadlineLabel: '10/13(화) 23:59',
  // 현장 배부 공지. index.html의 링크와 같은 주소
  openChatUrl: 'https://open.kakao.com/o/g384C4Ri',
});
export function ordersOpen(now = new Date()) {
  const time = new Date(now).getTime();
  return Number.isFinite(time) && time < new Date(GROUP_BUY.ordersCloseAt).getTime();
}
export const ORDER_STATUS = Object.freeze({payment_pending:'입금 대기',verification_requested:'입금 확인 요청',paid:'입금 확인 완료',cancel_requested:'취소 확인 요청',cancelled:'취소됨',refunded:'환불 완료',picked_up:'수령 완료'});

export function paymentWindowOpen(now = new Date()) {
  const time = new Date(now).getTime();
  return Number.isFinite(time) && time <= new Date(GROUP_BUY.paymentDeadline).getTime();
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
