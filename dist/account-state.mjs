import {GROUP_BUY, ordersOpen, ORDER_STATUS, orderAmount} from './group-buy.mjs?v=12';
// Design preview only. This store does not authenticate a Kakao account.
export const EVENTS = Object.freeze({
  inmufe: {available:true,name: "경기인디뮤직페스티벌", fullName: "경기인디뮤직페스티벌", dates: [{value:'2026-10-17',label:'10/17(토)'},{value:'2026-10-18',label:'10/18(일)'}]},
  sejong: {available:false,name: "세종보헤미안뮤직페스티벌", fullName: "세종보헤미안뮤직페스티벌", dates: [{value:'2026-10-30',label:'10/30(금)'},{value:'2026-10-31',label:'10/31(토)'},{value:'2026-11-01',label:'11/1(일)'}]},
});
export function pickupDateLabel(event, date) {
  return EVENTS[event]?.dates.find(day => day.value === date)?.label || '수령일 선택 필요';
}
export function validatePickupDate(event, date, {allowMissingDate = false} = {}) {
  if (!date && allowMissingDate) return null;
  if (!EVENTS[event]?.dates.some(day => day.value === date)) throw new Error('선택한 행사의 수령일을 골라주세요.');
  return date;
}
export const ACCOUNT_KEY = 'dance-slogan-preview-account-v2';
export const SESSION_KEY = 'dance-slogan-preview-session-v2';
export const LEGACY_KEY = 'dance-slogan-design-v1';
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
  if (!options.allowUnavailable && EVENTS[base.event].available === false) throw new Error('세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.');
  const payerName = String(value.payerName ?? '').trim();
  if (!payerName || [...payerName].length > 40 || /[<>\u0000-\u001f]/u.test(payerName)) throw new Error('입금자명을 1~40자로 입력해주세요.');
  const pickupDate = validatePickupDate(base.event,value.pickupDate,options);
  return {...base, payerName, pickupDate};
}
function read(store, key) {try {return JSON.parse(store.getItem(key));} catch {return null;}}
export class PreviewAccount {
  constructor(local, session) {
    this.local = local;
    this.session = session;
    this.profile = null;
    this.survey = null;
    this.order = null;
    this.signedIn = false;
    const data = read(local, ACCOUNT_KEY);
    if (data?.profile && validateNickname(data.profile.nickname).nickname) {
      this.profile = {nickname: validateNickname(data.profile.nickname).nickname};
      try {if (data.survey) this.survey = validateSurvey(data.survey);} catch {}
      try {
        if (data.order && /^PREVIEW-[A-F0-9]{8}$/u.test(data.order.id) && Object.hasOwn(ORDER_STATUS,data.order.status)) {
          const details = validateOrder(data.order,{allowMissingDate:true,allowUnavailable:true});
          const unitPrice = Number.isSafeInteger(data.order.unitPrice) && data.order.unitPrice >= 0 ? data.order.unitPrice : GROUP_BUY.unitPrice;
          this.order = {...details,id:data.order.id,status:data.order.status,nickname:validateNickname(data.order.nickname).nickname || this.profile.nickname,createdAt:String(data.order.createdAt),updatedAt:String(data.order.updatedAt),unitPrice,totalAmount:orderAmount(details.quantity,unitPrice)};
        }
      } catch {}
      try {this.signedIn = session.getItem(SESSION_KEY) === 'active';} catch {}
    }
  }
  persist() {
    try {this.local.setItem(ACCOUNT_KEY, JSON.stringify({profile: this.profile, survey: this.survey, order: this.order}));return true;} catch {return false;}
  }
  signIn() {
    if (!this.profile) throw new Error('닉네임을 먼저 설정해주세요.');
    this.signedIn = true;
    try {this.session.setItem(SESSION_KEY, 'active');} catch {}
  }
  setNickname(value, {onboarding = false} = {}) {
    if (!onboarding && !this.signedIn) throw new Error('로그인해주세요.');
    const result = validateNickname(value);
    if (result.error) throw new Error(result.error);
    this.profile = {nickname: result.nickname};
    if (onboarding) this.signIn();
    return this.persist();
  }
  submitSurvey(value) {
    if (!this.signedIn || !this.profile) throw new Error('로그인 후 닉네임을 설정해주세요.');
    this.survey = validateSurvey(value);
    return this.persist();
  }
  cancelSurvey() {
    if (!this.signedIn) throw new Error('로그인해주세요.');
    this.survey = null;
    return this.persist();
  }
  placeOrder(value, now = new Date()) {
    if (!this.signedIn || !this.profile) throw new Error('로그인 후 닉네임을 설정해주세요.');
    if (!ordersOpen(now)) throw new Error('주문 접수가 마감되었어요.');
    if (this.order && !['payment_pending','cancelled'].includes(this.order.status)) throw new Error('입금 확인 또는 취소 확인 중에는 주문을 수정할 수 없어요.');
    const details = validateOrder(value);
    const previous = this.order?.status === 'payment_pending' ? this.order : null;
    this.order = {...details,id:previous?.id || `PREVIEW-${crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase()}`,nickname:this.profile.nickname,status:'payment_pending',createdAt:previous?.createdAt || new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),unitPrice:GROUP_BUY.unitPrice,totalAmount:orderAmount(details.quantity)};
    return this.persist();
  }
  setPickupDate(date, now = new Date()) {
    if (!this.signedIn || !this.order) throw new Error('로그인 후 주문 내역을 확인해주세요.');
    if (!ordersOpen(now) || !['payment_pending','verification_requested'].includes(this.order.status)) throw new Error('현재 상태에서는 수령일을 추가할 수 없어요.');
    if (EVENTS[this.order.event].available === false) throw new Error('세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.');
    this.order.pickupDate = validatePickupDate(this.order.event,date);
    this.order.updatedAt = new Date(now).toISOString();
    return this.persist();
  }
  requestPaymentCheck() {
    if (!this.signedIn || !this.order) throw new Error('로그인 후 주문 내역을 확인해주세요.');
    if (this.order.status !== 'payment_pending') throw new Error('이미 요청되었거나 취소된 주문이에요.');
    this.order.status = 'verification_requested';
    this.order.updatedAt = new Date().toISOString();
    return this.persist();
  }
  cancelOrder(now = new Date()) {
    if (!this.signedIn || !this.order) throw new Error('로그인 후 주문 내역을 확인해주세요.');
    if (this.order.status === 'cancelled' || this.order.status === 'cancel_requested') throw new Error('이미 취소되었거나 취소 확인 중인 주문이에요.');
    this.order.status = this.order.status === 'payment_pending' && ordersOpen(now) ? 'cancelled' : 'cancel_requested';
    this.order.updatedAt = new Date().toISOString();
    return this.persist();
  }
  logout() {
    this.signedIn = false;
    try {this.session.removeItem(SESSION_KEY);} catch {}
  }
  withdraw() {
    if (!this.signedIn) throw new Error('로그인해주세요.');
    if (this.order && this.order.status !== 'cancelled') throw new Error('진행 중인 주문이 있어요. 주문 처리 후 탈퇴할 수 있어요.');
    // Do not claim deletion when the browser refuses to remove stored data.
    this.local.removeItem(ACCOUNT_KEY);
    this.local.removeItem(LEGACY_KEY);
    this.session.removeItem(SESSION_KEY);
    this.profile = null;
    this.survey = null;
    this.order = null;
    this.signedIn = false;
  }
  legacyDraft() {
    const draft = read(this.local, LEGACY_KEY);
    if (draft && Number.isInteger(draft.quantity) && draft.quantity >= 1 && draft.quantity <= 20) {
      return {quantity: draft.quantity};
    }
    return null;
  }
}
