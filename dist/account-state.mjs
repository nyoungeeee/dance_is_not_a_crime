import {GROUP_BUY} from './group-buy.mjs?v=18';
// 화면에서 미리 안내하기 위한 검증. 실제 판단은 서버(server/src/common/group-buy.ts)가 한다.
export const EVENTS = Object.freeze({
  inmufe: {name: "경기인디뮤직페스티벌", fullName: "경기인디뮤직페스티벌", dates: [{value:'2026-10-17',label:'10/17(토)'},{value:'2026-10-18',label:'10/18(일)'}]},
  sejong: {name: "세종보헤미안뮤직페스티벌", fullName: "세종보헤미안뮤직페스티벌", dates: [{value:'2026-10-31',label:'10/31(토)'},{value:'2026-11-01',label:'11/1(일)'}]},
});
export function pickupDateLabel(event, date) {
  return EVENTS[event]?.dates.find(day => day.value === date)?.label || '수령일 선택 필요';
}
export function validatePickupDate(event, date, {allowMissingDate = false} = {}) {
  if (!date && allowMissingDate) return null;
  if (!EVENTS[event]?.dates.some(day => day.value === date)) throw new Error('선택한 행사의 수령일을 골라주세요.');
  return date;
}
export function validateNickname(value) {
  const nickname = String(value ?? '').trim();
  const count = [...nickname].length;
  if (count < 2 || count > 20) return {error: '닉네임은 2~20자로 입력해주세요.'};
  if (!/^[\p{L}\p{N}\p{M} ._-]+$/u.test(nickname)) return {error: '한글·영문·숫자·공백과 . _ -만 사용할 수 있어요.'};
  return {nickname};
}
export function validateSurvey(value) {
  if (!value || !Number.isInteger(value.quantity) || value.quantity < GROUP_BUY.minQuantity || value.quantity > GROUP_BUY.maxQuantity) throw new Error('주문 수량은 1~20개의 정수로 입력해주세요.');
  if (!Object.hasOwn(EVENTS, value.event)) throw new Error('수령할 행사를 선택해주세요.');
  return {quantity: value.quantity, event: value.event};
}
export function validateOrder(value, options = {}) {
  const base = validateSurvey(value);
  if (!GROUP_BUY.events.includes(base.event)) throw new Error(`이번 공동구매는 ${GROUP_BUY.events.map(e => EVENTS[e].name).join(', ')} 수령만 받아요.`);
  const payerName = String(value.payerName ?? '').trim();
  if (!payerName || [...payerName].length > 40 || /[<>\u0000-\u001f]/u.test(payerName)) throw new Error('입금자명을 1~40자로 입력해주세요.');
  const pickupDate = validatePickupDate(base.event,value.pickupDate,options);
  return {...base, payerName, pickupDate};
}
