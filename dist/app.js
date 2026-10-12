import {validateMessage} from './messages.mjs?v=24';
import {EVENTS, validateNickname, validateOrder, pickupDateLabel} from './account-state.mjs?v=13';
import {GROUP_BUY, ordersOpen, ORDER_STATUS, paymentWindowOpen, parseQuantity, orderAmount, getOrderCountdown} from './group-buy.mjs?v=13';
import {api} from './api.mjs?v=1';
const $ = selector => document.querySelector(selector);
const modal = $('#modal'), content = $('#modal-content'), form = $('#order-form');
// 계정·주문·새 답변 수는 서버(/api/me)가 기준. 화면은 받은 값을 보여주기만 한다.
let me = {user:null, order:null, unread:0};
let quantity = 1, toastTimer, loginIntent = 'login', messagePoll;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const signedIn = () => !!me.user?.nickname;
const nickname = () => me.user?.nickname ?? null;
const activeOrder = () => me.order && !['cancelled','refunded'].includes(me.order.status) ? me.order : null;
async function loadMe() {
  try {me = await api('GET','/api/me');}
  catch(error) {toast(error.message);}
  refresh();
  return me;
}
/** 버튼을 잠시 막아 두 번 눌러 중복 요청이 가지 않게 한다. */
async function busy(button, task) {
  if(button?.disabled) return;
  if(button) button.disabled = true;
  try {return await task();}
  finally {if(button?.isConnected) button.disabled = false;}
}
function refreshQuantity() {
  const input = $('#quantity');
  if (document.activeElement !== input && quantity !== null) input.value = String(quantity);
  input.setCustomValidity(quantity === null ? '주문 수량을 1~20개의 정수로 입력해주세요.' : '');
  $('#minus').disabled = quantity !== null && quantity <= GROUP_BUY.minQuantity;
  $('#plus').disabled = quantity !== null && quantity >= GROUP_BUY.maxQuantity;
  const amount = orderAmount(quantity);
  $('#order-total').textContent = amount === null ? '수량을 입력해주세요' : `${amount.toLocaleString('ko-KR')}원`;
}
function refresh() {
  const on = signedIn();
  $('#header-login').hidden = on;
  $('#account-button').hidden = !on;
  $('#header-nickname').textContent = on ? nickname() : '';
  $('#menu-nickname').textContent = on ? nickname() : '';
  $('#admin-menu-item').hidden = !(on && me.user.isAdmin);
  $('#profile-status').textContent = on ? `${nickname()} 님의 주문 정보예요.` : '카카오 로그인 후 닉네임을 설정해주세요.';
  const active = activeOrder();
  const editable = ordersOpen() && (!active || active.status === 'payment_pending');
  $('#submit-label').textContent = on ? (editable ? (active ? '주문서 수정' : '주문서 제출') : active ? '내 주문 확인' : '주문 접수 마감') : ordersOpen() ? '카카오 로그인하고 주문서 작성' : '주문 접수 마감';
  $('#submit-order').disabled = !ordersOpen() && !(on && active);
  $('#submit-order').classList.toggle('kakao', !on);
  $('#submit-order').classList.toggle('primary', on);
  $('#kakao-icon').hidden = on;
  $('#saved-notice').hidden = !(on && active);
  if(active) $('#saved-status').textContent = `${ORDER_STATUS[active.status]} · 주문번호 ${active.id}`;
  refreshQuantity();
  refreshInquiryBadge();
}
function pickupDayChoices(event, selectedDate = null, name = 'pickupDate') {
  if(!Object.hasOwn(EVENTS,event)) return '<p class="field-hint">수령할 행사를 먼저 선택해주세요.</p>';
  if(EVENTS[event].available === false) return '<p class="field-hint">세종보헤미안뮤직페스티벌 수령은 추후 오픈 예정이에요.</p>';
  return EVENTS[event].dates.map(day => `<label><input type="radio" name="${name}" value="${day.value}" required ${day.value === selectedDate ? 'checked' : ''}><span>${day.label}</span></label>`).join('');
}
function renderPickupDays(event, selectedDate = null) {
  $('#pickup-date-options').innerHTML = pickupDayChoices(event, selectedDate);
}
form.querySelectorAll('[name="event"]').forEach(input => input.addEventListener('change', () => {if(EVENTS[input.value]?.available !== false) renderPickupDays(input.value);}));
function setDraft(record) {
  quantity = record.quantity;
  const selectedEvent = EVENTS[record.event]?.available === false ? null : record.event;
  form.elements.event.value = selectedEvent || '';
  renderPickupDays(selectedEvent,record.pickupDate);
  $('#payer-name').value = record.payerName || '';
  $('#consent').checked = !!record.payerName;
  refreshQuantity();
}
function clearDraft() {
  form.reset(); quantity = 1;renderPickupDays(null);
  refreshQuantity();
}
function changeQuantity(delta) {
  const current = parseQuantity($('#quantity').value) ?? GROUP_BUY.minQuantity;
  quantity = Math.max(GROUP_BUY.minQuantity, Math.min(GROUP_BUY.maxQuantity, current + delta));
  $('#quantity').value = String(quantity);
  refresh();
}
$('#minus').addEventListener('click', () => changeQuantity(-1));
$('#plus').addEventListener('click', () => changeQuantity(1));
$('#quantity').addEventListener('input', event => {quantity = parseQuantity(event.currentTarget.value);refresh();});
$('#quantity').addEventListener('blur', event => {quantity = parseQuantity(event.currentTarget.value);refresh();});
function toggleMenu(open, {restoreFocus = false} = {}) {
  $('#account-menu').hidden = !open;
  $('#account-button').setAttribute('aria-expanded', String(open));
  if(restoreFocus) $('#account-button').focus();
}
$('#account-button').addEventListener('click', () => toggleMenu($('#account-menu').hidden));
// Keyboard navigation uses normal buttons and tab order; Escape restores focus.
$('#account-menu').addEventListener('keydown', event => {
  const buttons = [...$('#account-menu').querySelectorAll('button:not([hidden])')];
  const index = buttons.indexOf(document.activeElement);
  if(event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();}
});
$('#account-button').addEventListener('keydown', event => {if(event.key === 'ArrowDown') {event.preventDefault();toggleMenu(true);$('#account-menu button').focus();}});
$('#account-area').addEventListener('focusout', event => {if(!$('#account-area').contains(event.relatedTarget)) toggleMenu(false);});
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !$('#account-menu').hidden) {event.preventDefault();toggleMenu(false,{restoreFocus:true});}});
function openModal(html, {wide = false} = {}) {
  toggleMenu(false);
  clearInterval(messagePoll);
  content.innerHTML = html;
  modal.classList.remove('modal-messages');
  modal.classList.toggle('modal-design', wide);
  if(!modal.open) modal.showModal();
  document.body.style.overflow = 'hidden';
  modal.scrollTop = 0;
  $('.modal-close').focus();
}
function closeModal() {modal.close();}
modal.addEventListener('close', () => {if(modal.open) return;clearInterval(messagePoll);document.body.style.overflow = '';modal.classList.remove('modal-design','modal-messages');});
$('.modal-close').addEventListener('click', closeModal);
// No backdrop dismissal: dragging or selecting text must not close the dialog.
function toast(message) {$('#toast').textContent = message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);}
function goToForm() {closeModal();$('#participate').scrollIntoView({behavior:'smooth'});$('#submit-order').focus({preventScroll:true});}
function loginPrompt(intent = 'login') {
  loginIntent = intent;
  openModal(`<div class="modal-label">로그인</div><h2 id="modal-title">카카오로 로그인</h2><p>로그인 후 사용할 닉네임을 설정해요. 같은 계정으로 주문 내역과 입금 확인 상태를 확인할 수 있어요.</p><p class="auth-note">카카오에서는 회원번호만 받아요. 이름·전화번호·이메일은 받지 않아요.</p><a class="button kakao" href="/api/auth/kakao/login?intent=${encodeURIComponent(intent)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.4 2 10.6c0 2.7 1.8 5 4.5 6.4l-.9 3.5 4-2.4c.8.1 1.6.2 2.4.2 5.5 0 10-3.5 10-7.7S17.5 3 12 3Z"/></svg>카카오로 계속하기</a>`);
}
function continueIntent(intent) {
  if(intent === 'order') {closeModal();if(activeOrder()) setDraft(activeOrder());$('#participate').scrollIntoView({behavior:'smooth'});$('#submit-order').focus({preventScroll:true});}
  else if(intent === 'my') myOrder();
  else if(intent === 'message') messages();
  else if(intent === 'admin') location.href = '/admin';
}
function nicknameForm(isNew = false) {
  if(!me.user) {loginPrompt();return;}
  openModal(`<div class="modal-label">${isNew ? '로그인 다음 단계' : '내 계정'}</div><h2 id="modal-title">${isNew ? '사용할 닉네임을 알려주세요' : '닉네임 수정'}</h2><p>주문 내역과 현장 수령 확인에 사용할 닉네임이에요.</p><form class="nickname-form" id="nickname-form"><label for="nickname-input">닉네임</label><input id="nickname-input" name="nickname" autocomplete="nickname" placeholder="닉네임 입력" required aria-describedby="nickname-hint nickname-error"><p class="field-hint" id="nickname-hint">2~20자 · 한글, 영문, 숫자, 공백, . _ - 사용 가능</p><p class="field-error" id="nickname-error" role="alert"></p><button class="button primary" type="submit" id="nickname-submit">${isNew ? '닉네임 설정하고 시작하기' : '닉네임 저장'}</button></form>`);
  $('#nickname-input').value = me.user.nickname || '';
  $('#nickname-input').focus();
  $('#nickname-input').addEventListener('input', () => {$('#nickname-input').removeAttribute('aria-invalid');$('#nickname-error').textContent = '';});
  $('#nickname-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = validateNickname($('#nickname-input').value);
    if(result.error) {$('#nickname-error').textContent = result.error;$('#nickname-input').setAttribute('aria-invalid','true');$('#nickname-input').focus();return;}
    busy($('#nickname-submit'), async () => {
      try {
        const {user} = await api('PATCH','/api/me',{nickname:result.nickname});
        me.user = user;
        refresh();
        closeModal();
        toast(isNew ? '닉네임을 설정했어요. 주문서를 작성할 수 있어요.' : '닉네임을 수정했어요.');
        if(isNew) continueIntent(loginIntent);
      } catch(error) {$('#nickname-error').textContent = error.message;}
    });
  });
}
/** 카카오 로그인 후 돌아온 주소(?login=…&intent=…)를 처리하고 주소창에서는 지운다. */
function handleLoginReturn() {
  const params = new URLSearchParams(location.search);
  const result = params.get('login');
  if(!result) return;
  loginIntent = params.get('intent') || 'login';
  history.replaceState(null, '', location.pathname + location.hash);
  if(result === 'cancelled') {toast('카카오 로그인을 취소했어요.');return;}
  if(result === 'error' || !me.user) {toast('로그인하지 못했어요. 잠시 후 다시 시도해주세요.');return;}
  if(!me.user.nickname) {nicknameForm(true);return;}
  toast(`${nickname()} 님, 반가워요.`);
  continueIntent(loginIntent);
}
function draftRecord() {const data = new FormData(form);return {quantity:parseQuantity($('#quantity').value), event:data.get('event'), payerName:data.get('payerName'), pickupDate:data.get('pickupDate')};}
/** 주문 진행 단계. 끝난 단계는 done, 지금 기다리는 단계는 current. 취소 계열은 단계 대신 상태만 보여준다. */
const PROGRESS_STEPS = ['주문서 제출','입금 확인 요청','입금 확인 완료','현장 수령'];
function orderProgress(record) {
  if(['cancel_requested','cancelled','refunded'].includes(record.status)) return `<div class="order-progress is-cancel"><span>${ORDER_STATUS[record.status]}</span></div>`;
  const done = {payment_pending:1,verification_requested:2,paid:3,picked_up:4}[record.status] ?? 1;
  return `<div class="order-progress" aria-label="주문 진행 단계">${PROGRESS_STEPS.map((step, i) => i < done ? `<span class="done">✓ ${step}</span>` : i === done ? `<span class="current" aria-current="step">${step}</span>` : `<span>${step}</span>`).join('')}</div>`;
}
function responseRows(record) {
  return `<div class="modal-detail-table"><div><span>주문번호</span><strong>${escapeHTML(record.id)}</strong></div><div><span>주문 닉네임</span><strong>${escapeHTML(record.nickname)}</strong></div><div><span>주문 수량</span><strong>${record.quantity}개</strong></div><div><span>수령 행사</span><strong>${EVENTS[record.event]?.name ?? ''}</strong></div><div><span>수령일</span><strong>${pickupDateLabel(record.event,record.pickupDate)}</strong></div><div><span>입금자명</span><strong>${escapeHTML(record.payerName)}</strong></div><div><span>상태</span><strong>${ORDER_STATUS[record.status] ?? ''}</strong></div><div><span>입금 금액</span><strong>${record.totalAmount.toLocaleString('ko-KR')}원</strong></div></div>`;
}
async function submitOrder() {
  let record;
  try {record = validateOrder(draftRecord());} catch(error) {toast(error.message);return;}
  await busy($('#submit-order'), async () => {
    try {
      const {order, created} = await api('PUT','/api/orders/mine',record);
      me.order = order;refresh();
      openModal(`<div class="modal-label">주문서</div><h2 id="modal-title">${created ? '주문서를 접수했어요' : '주문서를 수정했어요'}</h2>${responseRows(order)}<p>아직 주문 확정 전이에요. 입금 안내에 따라 ${GROUP_BUY.paymentDeadlineLabel}까지 입금해주세요. 운영자가 입금 내역을 확인하면 '입금 확인 완료'로 바뀌어요.</p><div class="modal-actions"><button class="button primary" data-action="order">입금 안내 보기</button><button class="button secondary" data-action="my">내 주문 확인</button></div>`);
    } catch(error) {
      if(error.status === 401) {await loadMe();loginPrompt('order');return;}
      toast(error.message);await loadMe();
    }
  });
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const active = activeOrder();
  if(signedIn() && active && (!ordersOpen() || active.status !== 'payment_pending')) {myOrder();return;}
  if(!form.reportValidity()) return;
  if(!ordersOpen()) {toast('주문 접수가 마감되었어요.');refresh();return;}
  if(!signedIn()) {me.user ? nicknameForm(true) : loginPrompt('order');return;}
  submitOrder();
});
async function myOrder() {
  if(!signedIn()) {loginPrompt('my');return;}
  await loadMe();
  const order = me.order;
  if(!order) {openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">주문 내역이 없어요</h2><p>${escapeHTML(nickname())} 님, 주문 수량과 수령할 행사를 선택해주세요.</p><button class="button primary" data-action="go-form">주문서 작성</button>`);return;}
  const closed = ['cancelled','refunded'].includes(order.status);
  const editable = ordersOpen() && order.status === 'payment_pending';
  const needsDate = !order.pickupDate && EVENTS[order.event]?.available !== false && ordersOpen() && ['payment_pending','verification_requested'].includes(order.status);
  const cancellable = !['cancelled','cancel_requested','refunded','picked_up'].includes(order.status);
  const note = {payment_pending:'입금 후 \'입금 확인 요청\'을 눌러주세요. 요청만으로 주문이 확정되지는 않아요.',verification_requested:'운영자가 입금 내역을 확인하고 있어요. 확인되면 \'입금 확인 완료\'로 바뀌어요.',paid:'입금이 확인됐어요. 선택한 행사에서 수령해주세요.',cancel_requested:'운영자가 취소와 환불 여부를 확인하고 있어요.',cancelled:'취소된 주문이에요.',refunded:'환불이 완료된 주문이에요.',picked_up:'수령이 완료된 주문이에요.'}[order.status] ?? '';
  openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">주문 내역</h2>${orderProgress(order)}${responseRows(order)}<p>${note}</p><div class="modal-actions">${needsDate ? '<button class="button primary" data-action="pickup-date">수령일 추가</button>' : ''}${editable ? '<button class="button primary" data-action="edit">주문서 수정</button>' : ''}${!closed ? '<button class="button secondary" data-action="order">입금 안내</button>' : ordersOpen() ? '<button class="button primary" data-action="go-form">새 주문서 작성</button>' : ''}</div>${cancellable ? '<button class="danger-action" data-action="cancel-confirm">주문 취소</button>' : ''}`);
}
function paymentGuide() {
  const record = signedIn() ? activeOrder() : null;
  if(!record) {openModal(`<div class="modal-label">입금 안내</div><h2 id="modal-title">주문서를 먼저 작성해주세요</h2><p>주문서를 제출하면 주문번호와 입금 안내를 확인할 수 있어요.</p><button class="button primary" data-action="go-form">주문서 작성</button>`);return;}
  const pending = record.status === 'payment_pending';
  openModal(`<div class="modal-label">입금 안내</div><h2 id="modal-title">${pending ? '주문서 제출 다음 단계' : '입금 안내'}</h2>${orderProgress(record)}${responseRows(record)}<div class="payment-details"><p class="payment-bank-name"><strong>${escapeHTML(GROUP_BUY.bankAccount.bank)}</strong><span>예금주 ${escapeHTML(GROUP_BUY.bankAccount.holder)}</span></p><p class="payment-account-number">${escapeHTML(GROUP_BUY.bankAccount.number)}</p><div class="payment-copy-buttons"><button class="text-button" data-action="copy-account">계좌번호 복사</button><button class="text-button" data-action="copy-amount">입금 금액 복사</button></div><p class="payment-deadline">입금 기한: ${GROUP_BUY.paymentDeadlineLabel}<br>주문 마감: ${GROUP_BUY.ordersCloseLabel}</p></div><p>${paymentWindowOpen() ? `입금자명 <strong>${escapeHTML(record.payerName)}</strong>(으)로 ${record.totalAmount.toLocaleString('ko-KR')}원을 보내주세요. 입금한 뒤 아래 버튼을 눌러주세요.` : '입금 기한이 지났어요. 입금 여부는 운영자가 실제 입금 내역으로 확인해요.'} 운영자가 입금 내역을 대조한 뒤 주문이 확정돼요.</p><button class="button primary" data-action="payment-request" ${pending ? '' : 'disabled'}>${pending ? '입금했어요 · 입금 확인 요청' : ORDER_STATUS[record.status]}</button><button class="button secondary" data-action="my">내 주문 확인</button>`);
}
function addPickupDate() {
  const record = activeOrder();
  if(!signedIn() || !record) {loginPrompt('my');return;}
  openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">수령일을 선택해주세요</h2><p>${EVENTS[record.event].name}에서 수령할 날짜를 골라주세요. 주문번호와 입금 확인 상태는 그대로 유지돼요.</p><form id="add-pickup-date-form"><div class="pickup-days">${pickupDayChoices(record.event,record.pickupDate,'newPickupDate')}</div><button class="button primary" type="submit" id="pickup-date-submit">수령일 저장</button><p class="field-error" id="pickup-date-error" role="alert"></p></form>`);
  $('#add-pickup-date-form').addEventListener('submit',event => {
    event.preventDefault();const pickupDate = new FormData(event.currentTarget).get('newPickupDate');
    busy($('#pickup-date-submit'), async () => {
      try {me.order = (await api('PATCH','/api/orders/mine/pickup-date',{pickupDate})).order;refresh();await myOrder();toast('수령일을 저장했어요.');}
      catch(error) {$('#pickup-date-error').textContent = error.message;}
    });
  });
}
function withdrawConfirm() {
  if(!signedIn()) {loginPrompt();return;}
  openModal(`<div class="modal-label">내 계정</div><h2 id="modal-title">회원탈퇴</h2><p><span class="nickname-display">${escapeHTML(nickname())}</span> 님의 계정을 삭제합니다.</p><ul class="withdraw-list"><li>진행 중인 주문이 있으면 주문 처리 후 탈퇴할 수 있어요.</li><li>닉네임과 문의 대화가 삭제되고, 카카오 계정과의 연결이 해제돼요.</li><li>지난 주문 기록(주문번호·수량·입금자명·금액)은 입금 대조와 환불 확인을 위해 닉네임 없이 보관돼요.</li></ul><label class="withdraw-checkbox"><input id="withdraw-consent" type="checkbox"><span>위 내용을 확인했어요.</span></label><p id="withdraw-error" class="field-error" role="alert"></p><div class="modal-actions"><button class="button secondary" data-action="close">취소</button><button class="button danger" id="withdraw-button" data-action="withdraw" disabled>탈퇴하기</button></div>`);
  const blocked = !!activeOrder() && !['picked_up'].includes(activeOrder().status);
  if(blocked) $('#withdraw-error').textContent = '진행 중인 주문이 있어요. 주문 처리 후 탈퇴할 수 있어요.';
  $('#withdraw-consent').addEventListener('change', () => $('#withdraw-button').disabled = blocked || !$('#withdraw-consent').checked);
}
async function copyPaymentValue(kind) {
  const record = activeOrder();
  if(!signedIn() || !record) {toast('주문 내역을 먼저 확인해주세요.');return;}
  const isAccount = kind === 'account';
  const value = isAccount ? GROUP_BUY.bankAccount.number.replace(/\D/g,'') : String(record.totalAmount);
  const label = isAccount ? '계좌번호' : '입금 금액';
  try {await navigator.clipboard.writeText(value);toast(`${label}을 복사했어요.`);}
  catch {
    openModal(`<div class="modal-label">입금 안내</div><h2 id="modal-title">${label} 복사</h2><p>아래 값을 선택해 복사해주세요.</p><input id="payment-copy-value" class="share-link" readonly aria-label="${label}"><button class="button secondary" data-action="order">입금 안내로 돌아가기</button>`);
    $('#payment-copy-value').value=value;$('#payment-copy-value').focus();$('#payment-copy-value').select();
  }
}
async function share() {
  const url = new URL(location.href);url.hash = '';url.search = '';
  try {await navigator.clipboard.writeText(url.href);toast('주문 링크를 복사했어요.');}
  catch {openModal(`<div class="modal-label">링크 공유</div><h2 id="modal-title">주문 링크</h2><p>아래 링크를 복사해 공유해주세요.</p><input id="share-link" class="share-link" aria-label="공유 링크" readonly><button class="button primary" data-action="select-share">링크 선택하기</button>`);$('#share-link').value = url.href;$('#share-link').select();}
}
function refreshInquiryBadge() {
  const count = signedIn() ? me.unread : 0;
  document.querySelectorAll('[data-inquiry-count]').forEach(badge => {badge.hidden = !count;badge.textContent = String(count);});
}
async function messages() {
  if(!signedIn()) {me.user ? nicknameForm(true) : loginPrompt('message');return;}
  openModal(`<div class="modal-label">운영자에게 문의</div><h2 id="modal-title">문의 메시지</h2><p class="message-preview-note">운영자가 확인 후 이 대화에 답변해요. 실시간 상담은 아니에요.</p><div class="message-history" id="message-history" role="log" aria-live="polite" aria-label="문의 대화"><p class="message-empty">불러오는 중…</p></div><form id="message-form" class="message-compose"><label class="sr-only" for="message-input">문의 내용</label><textarea id="message-input" rows="3" maxlength="1000" placeholder="궁금한 점을 남겨주세요" aria-describedby="message-count message-error"></textarea><div class="message-compose-bottom"><span id="message-count">0 / 500</span><button type="submit" class="button lime" id="message-send">보내기</button></div><p id="message-error" class="field-error" role="alert"></p></form>`);
  modal.classList.add('modal-messages');
  const history = $('#message-history');
  let list = [];
  function renderHistory() {
    if(!list.length) {history.innerHTML='<p class="message-empty">수령·주문 관련 궁금한 점을 남겨주세요.<br>답변은 이 대화에서 확인할 수 있어요.</p>';return;}
    let day = '';
    const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 40;
    history.innerHTML = list.map(m => {
      const date = new Date(m.createdAt);
      const currentDay = date.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
      const divider = currentDay !== day ? `<p class="message-day">${currentDay}</p>` : '';day=currentDay;
      const mine = m.sender === 'user';
      const time = date.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
      return divider + `<div class="message-row ${mine ? 'outgoing' : 'incoming'}"><span class="message-sender">${mine ? escapeHTML(nickname()) : '운영자'}</span><div class="message-bubble">${escapeHTML(m.text)}</div><span class="message-meta">${mine ? (m.read ? '읽음 · ' : '보냄 · ') : '받음 · '}${time}</span></div>`;
    }).join('');
    if(atBottom || !history.dataset.loaded) history.scrollTop = history.scrollHeight;
    history.dataset.loaded = '1';
  }
  async function reload() {
    try {list = (await api('GET','/api/messages')).messages;me.unread = 0;refreshInquiryBadge();renderHistory();}
    catch(error) {$('#message-error').textContent = error.message;}
  }
  await reload();
  // 대화창이 열려 있는 동안 30초마다 새 답변을 확인한다.
  clearInterval(messagePoll);
  messagePoll = setInterval(() => {if(modal.open && modal.classList.contains('modal-messages') && !document.hidden) reload();}, 30000);
  const input = $('#message-input'), send = $('#message-send');
  function updateCount() {const count=Array.from(input.value).length;$('#message-count').textContent=`${count} / 500`;$('#message-count').classList.toggle('over-limit',count>500);send.disabled=!input.value.trim()||count>500;$('#message-error').textContent='';}
  input.addEventListener('input', updateCount);updateCount();
  $('#message-form').addEventListener('submit', event => {
    event.preventDefault();
    let text;
    try {text = validateMessage(input.value);} catch(error) {$('#message-error').textContent=error.message;return;}
    busy(send, async () => {
      try {
        const {message} = await api('POST','/api/messages',{text});
        list.push(message);input.value='';updateCount();history.dataset.loaded='';renderHistory();
        input.focus({preventScroll:true});
      } catch(error) {$('#message-error').textContent=error.message;}
    });
  });
}
document.addEventListener('click', event => {
  if(!$('#account-area').contains(event.target)) toggleMenu(false);
  const button = event.target.closest('[data-action]');if(!button) return;
  toggleMenu(false);
  switch(button.dataset.action) {
    case 'login': loginPrompt();break;
    case 'nickname-edit': nicknameForm();break;
    case 'logout':
      busy(button, async () => {
        try {await api('POST','/api/auth/logout');} catch {}
        me = {user:null, order:null, unread:0};clearDraft();refresh();closeModal();toast('로그아웃했어요. 주문 내역은 유지돼요.');$('#header-login').focus();
      });break;
    case 'withdraw-confirm': withdrawConfirm();break;
    case 'withdraw':
      if(!$('#withdraw-consent')?.checked) return;
      busy(button, async () => {
        try {await api('DELETE','/api/me');me = {user:null, order:null, unread:0};clearDraft();refresh();closeModal();toast('탈퇴했어요. 이용해주셔서 고마워요.');$('#header-login').focus();}
        catch(error) {$('#withdraw-error').textContent = error.message;}
      });break;
    case 'my': myOrder();break;
    case 'message': messages();break;
    case 'admin': location.href = '/admin';break;
    case 'pickup-date': addPickupDate();break;
    case 'order': paymentGuide();break;
    case 'copy-account': copyPaymentValue('account');break;
    case 'copy-amount': copyPaymentValue('amount');break;
    case 'payment-request':
      busy(button, async () => {
        try {me.order = (await api('POST','/api/orders/mine/payment-request')).order;refresh();await myOrder();toast('입금 확인을 요청했어요. 운영자가 확인하면 상태가 바뀌어요.');}
        catch(error) {toast(error.message);await loadMe();}
      });break;
    case 'edit':
      if(!signedIn()) loginPrompt('my');
      else if(!ordersOpen() || activeOrder()?.status !== 'payment_pending') toast('현재 상태에서는 주문서를 수정할 수 없어요.');
      else {setDraft(activeOrder());goToForm();toast('주문서를 변경하고 수정 버튼을 눌러주세요.');}break;
    case 'go-form': if(!activeOrder()) clearDraft();goToForm();break;
    case 'cancel-confirm': {
      if(!signedIn()) {loginPrompt('my');break;}
      const instant = activeOrder()?.status === 'payment_pending' && ordersOpen();
      openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">주문 취소</h2><p>${instant ? '입금 전 주문이라 바로 취소돼요.' : '입금 확인 요청 이후 또는 주문 마감 후에는 운영자가 입금 내역을 확인한 뒤 취소·환불을 처리해요.'} 주문 기록은 삭제하지 않아요.</p><div class="modal-actions"><button class="button secondary" data-action="my">돌아가기</button><button class="button primary" data-action="cancel">${instant ? '주문 취소' : '취소 요청'}</button></div>`);break;
    }
    case 'cancel':
      busy(button, async () => {
        try {me.order = (await api('POST','/api/orders/mine/cancel')).order;refresh();await myOrder();toast(me.order.status === 'cancelled' ? '주문을 취소했어요.' : '취소를 요청했어요. 운영자가 확인 후 처리해요.');}
        catch(error) {toast(error.message);await loadMe();}
      });break;
    case 'close': closeModal();break;
    case 'design': openModal(`<div class="modal-label">슬로건 디자인</div><h2 id="modal-title">춤은 불법이 아니다</h2><div class="design-gallery"><div class="towel-crop back"><img src="/assets/slogan.png" alt="춤추는 해골 패턴 면"></div><div class="towel-crop front"><img src="/assets/slogan.png" alt="춤은 불법이 아니다 문구 면"></div></div><p>소재·크기·인쇄 사양은 제작 조건 확인 후 안내할 예정이에요.</p>`, {wide:true});break;
    case 'share': share();break;
    case 'select-share': $('#share-link').focus();$('#share-link').select();break;
    case 'about': openModal(`<div class="modal-label">이용 안내</div><h2 id="modal-title">개인정보와 주문 기록</h2><div class="modal-detail-table"><div><span>카카오에서 받는 정보</span><strong>회원번호만 (이름·전화번호·이메일 없음)</strong></div><div><span>직접 입력하는 정보</span><strong>닉네임, 주문 수량·수령 행사·수령일, 입금자명, 문의 내용</strong></div><div><span>이용 목적</span><strong>주문 접수, 입금 대조, 현장 수령 확인, 문의 답변</strong></div><div><span>탈퇴 시</span><strong>닉네임·문의 대화 삭제, 카카오 연결 해제. 주문 기록은 입금 대조·환불 확인을 위해 닉네임 없이 보관</strong></div><div><span>로그인 유지</span><strong>14일 (로그아웃하면 즉시 종료)</strong></div></div><p>진행 중인 주문이 있으면 주문 처리 후 탈퇴할 수 있어요. 궁금한 점은 문의 메시지로 남겨주세요.</p><button class="button primary" data-action="close">닫기</button>`);break;
  }
});

let countdownClosed = null;
function updateCountdown(now = new Date()) {
  const time = getOrderCountdown(now);
  for(const unit of ['days','hours','minutes','seconds']) $(`#countdown-${unit}`).textContent=String(time[unit]).padStart(2,'0');
  $('#countdown-clock').setAttribute('aria-label',time.isClosed ? '주문 접수 마감' : `주문 마감까지 ${time.days}일 ${time.hours}시간 ${time.minutes}분 ${time.seconds}초 남음`);
  $('#order-countdown').classList.toggle('is-closed',time.isClosed);
  $('#countdown-closed').hidden=!time.isClosed;
  if(time.isClosed !== countdownClosed) {countdownClosed=time.isClosed;if(time.isClosed) refresh();}
}
updateCountdown();
setInterval(() => updateCountdown(),1000);
refresh();
loadMe().then(() => {
  if(activeOrder()) setDraft(activeOrder());
  handleLoginReturn();
});
// 다른 기기에서 바뀐 주문 상태·새 답변을 가끔 다시 확인한다.
document.addEventListener('visibilitychange',() => {updateCountdown();if(!document.hidden) loadMe();});
setInterval(() => {if(!document.hidden && signedIn()) loadMe();},60000);
