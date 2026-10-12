import {PreviewMessages, validateMessage} from './messages.mjs?v=23';
import {PreviewAccount, EVENTS, validateNickname, pickupDateLabel} from './account-state.mjs?v=12';
import {GROUP_BUY, ordersOpen, ORDER_STATUS, paymentWindowOpen, parseQuantity, orderAmount, getOrderCountdown} from './group-buy.mjs?v=12';
const $ = selector => document.querySelector(selector);
const modal = $('#modal'), content = $('#modal-content'), form = $('#order-form');
const account = new PreviewAccount({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)}, {getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)});
const inquiries = new PreviewMessages({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)});
let quantity = 1, toastTimer, loginIntent = 'login';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nickname = () => account.signedIn ? account.profile?.nickname : null;
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
  const signedIn = account.signedIn && !!account.profile;
  $('#header-login').hidden = signedIn;
  $('#account-button').hidden = !signedIn;
  $('#header-nickname').textContent = signedIn ? account.profile.nickname : '';
  $('#menu-nickname').textContent = signedIn ? account.profile.nickname : '';
  $('#profile-status').textContent = signedIn ? `${account.profile.nickname} 님의 주문 정보예요.` : '카카오 로그인 후 닉네임을 설정해주세요.';
    const activeOrder = account.order && account.order.status !== 'cancelled';
  const editable = ordersOpen() && (!activeOrder || account.order.status === 'payment_pending');
  $('#submit-label').textContent = signedIn ? (editable ? (activeOrder ? '주문서 수정 · 미리보기' : '주문서 제출 · 미리보기') : activeOrder ? '내 주문 확인' : '주문 접수 마감') : ordersOpen() ? '카카오 로그인하고 주문서 작성' : '주문 접수 마감';
  $('#submit-order').disabled = !ordersOpen() && !(signedIn && activeOrder);
  $('#submit-order').classList.toggle('kakao', !signedIn);
  $('#submit-order').classList.toggle('primary', signedIn);
  $('#kakao-icon').hidden = signedIn;
  $('#saved-notice').hidden = !(signedIn && activeOrder);
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
if (account.signedIn && account.order?.status !== 'cancelled' && account.order) setDraft(account.order);
else if(account.signedIn && account.survey) setDraft(account.survey);
else {const legacy = account.legacyDraft();if (legacy) setDraft(legacy);}
refresh();
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
  const buttons = [...$('#account-menu').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  if(event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();}
});
$('#account-button').addEventListener('keydown', event => {if(event.key === 'ArrowDown') {event.preventDefault();toggleMenu(true);$('#account-menu button').focus();}});
$('#account-area').addEventListener('focusout', event => {if(!$('#account-area').contains(event.relatedTarget)) toggleMenu(false);});
document.addEventListener('keydown', event => {if(event.key === 'Escape' && !$('#account-menu').hidden) {event.preventDefault();toggleMenu(false,{restoreFocus:true});}});
function openModal(html, {wide = false} = {}) {
  toggleMenu(false);
  content.innerHTML = html;
  modal.classList.remove('modal-messages');
  modal.classList.toggle('modal-design', wide);
  if(!modal.open) modal.showModal();
  document.body.style.overflow = 'hidden';
  modal.scrollTop = 0;
  $('.modal-close').focus();
}
function closeModal() {modal.close();}
modal.addEventListener('close', () => {if(modal.open) return;document.body.style.overflow = '';modal.classList.remove('modal-design','modal-messages');});
$('.modal-close').addEventListener('click', closeModal);
// No backdrop dismissal: dragging or selecting text must not close the dialog.
function toast(message) {$('#toast').textContent = message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);}
function goToForm() {closeModal();$('#participate').scrollIntoView({behavior:'smooth'});$('#submit-order').focus({preventScroll:true});}
function loginPreview(intent = 'login') {
  loginIntent = intent;
  openModal(`<div class="modal-label">로그인</div><h2 id="modal-title">카카오로 로그인</h2><p>로그인 후 사용할 닉네임을 설정해요. 같은 계정으로 주문 내역과 입금 확인 상태를 확인할 수 있어요.</p><p class="demo-notice">현재는 로그인 흐름의 미리보기예요. 카카오 계정 인증은 진행되지 않아요.</p><button class="button kakao" data-action="demo-auth">카카오 인증 다음 단계 체험</button>`);
}
function nicknameForm(isNew = false) {
  if(!isNew && !account.signedIn) {loginPreview();return;}
  openModal(`<div class="modal-label">${isNew ? '로그인 다음 단계' : '내 계정'}</div><h2 id="modal-title">${isNew ? '사용할 닉네임을 알려주세요' : '닉네임 수정'}</h2><p>주문 내역과 현장 수령 확인에 사용할 닉네임이에요.</p><form class="nickname-form" id="nickname-form"><label for="nickname-input">닉네임</label><input id="nickname-input" name="nickname" autocomplete="nickname" placeholder="닉네임 입력" required aria-describedby="nickname-hint nickname-error"><p class="field-hint" id="nickname-hint">2~20자 · 한글, 영문, 숫자, 공백, . _ - 사용 가능</p><p class="field-error" id="nickname-error" role="alert"></p><button class="button primary" type="submit">${isNew ? '닉네임 설정하고 시작하기' : '닉네임 저장'}</button></form><p class="auth-note">미리보기 닉네임은 이 브라우저에만 저장돼요.</p>`);
  $('#nickname-input').value = account.profile?.nickname || '';
  $('#nickname-input').focus();
  $('#nickname-input').addEventListener('input', () => {$('#nickname-input').removeAttribute('aria-invalid');$('#nickname-error').textContent = '';});
  $('#nickname-form').addEventListener('submit', event => {
    event.preventDefault();
    const result = validateNickname($('#nickname-input').value);
    if(result.error) {$('#nickname-error').textContent = result.error;$('#nickname-input').setAttribute('aria-invalid','true');$('#nickname-input').focus();return;}
    try {
      const persisted = account.setNickname(result.nickname, {onboarding:isNew});
      refresh();
      const intent = loginIntent;
      closeModal();
      toast(persisted ? (isNew ? '닉네임을 설정했어요. 주문서를 작성할 수 있어요.' : '닉네임을 수정했어요.') : '브라우저 저장이 제한돼 닉네임은 이번 화면에만 적용돼요.');
      if(isNew && intent === 'order') {$('#participate').scrollIntoView({behavior:'smooth'});$('#submit-order').focus({preventScroll:true});}
      if(isNew && intent === 'my') myPreview();
      if(isNew && intent === 'message') messagePreview();
    } catch(error) {$('#nickname-error').textContent = error.message;}
  });
}
function completeDemoAuth() {
  if(!account.profile) {nicknameForm(true);return;}
  account.signIn();
  if(account.order && account.order.status !== 'cancelled') setDraft(account.order);
  refresh();
  closeModal();
  toast(`${account.profile.nickname} 님으로 미리보기 로그인했어요.`);
  if(loginIntent === 'order') {$('#participate').scrollIntoView({behavior:'smooth'});$('#submit-order').focus({preventScroll:true});}
  if(loginIntent === 'my') myPreview();
  if(loginIntent === 'message') messagePreview();
}
function draftRecord() {const data = new FormData(form);return {quantity:parseQuantity($('#quantity').value), event:data.get('event'), payerName:data.get('payerName'), pickupDate:data.get('pickupDate')};}
function responseRows(record) {
  return `<div class="modal-detail-table"><div><span>주문번호</span><strong>${escapeHTML(record.id)}</strong></div><div><span>주문 닉네임</span><strong>${escapeHTML(record.nickname)}</strong></div><div><span>주문 수량</span><strong>${record.quantity}개</strong></div><div><span>수령 행사</span><strong>${EVENTS[record.event].name}</strong></div><div><span>수령일</span><strong>${pickupDateLabel(record.event,record.pickupDate)}</strong></div><div><span>입금자명</span><strong>${escapeHTML(record.payerName)}</strong></div><div><span>상태</span><strong>${ORDER_STATUS[record.status]}</strong></div><div><span>입금 금액</span><strong>${record.totalAmount == null ? '가격 설정 전' : record.totalAmount.toLocaleString('ko-KR') + '원'}</strong></div></div>`;
}
function submitPreview() {
  try {
    const persisted = account.placeOrder(draftRecord());refresh();
    openModal(`<div class="modal-label">주문서 · 미리보기</div><h2 id="modal-title">주문서를 저장했어요</h2>${responseRows(account.order)}<p class="demo-notice">${persisted ? '이 브라우저에만 저장된 체험 주문이에요.' : '브라우저 저장이 제한되어 이번 화면에서만 확인할 수 있어요.'} 실제 주문으로 접수되지 않으며, 입금하거나 발주하지 않습니다.</p><div class="modal-actions"><button class="button primary" data-action="order">입금 안내 보기</button><button class="button secondary" data-action="my">내 주문 확인</button></div>`);
  } catch(error) {toast(error.message);}
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if(account.signedIn && account.order && account.order.status !== 'cancelled' && (!ordersOpen() || account.order.status !== 'payment_pending')) {myPreview();return;}
  if(!form.reportValidity()) return;
  if(!ordersOpen()) {toast('주문 접수가 마감되었어요.');refresh();return;}
  if(!account.signedIn) loginPreview('order');else submitPreview();
});
function myPreview() {
  if(!account.signedIn) {loginPreview('my');return;}
  if(!account.order) {openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">주문 내역이 없어요</h2><p>${escapeHTML(nickname())} 님, 주문 수량과 수령할 행사를 선택해주세요. 기존 수요조사 응답은 주문으로 자동 전환되지 않아요.</p><button class="button primary" data-action="go-form">주문서 작성</button>`);return;}
  const editable = ordersOpen() && account.order.status === 'payment_pending';
  const needsDate = !account.order.pickupDate && EVENTS[account.order.event].available !== false && ordersOpen() && ['payment_pending','verification_requested'].includes(account.order.status);
  const cancellable = !['cancelled','cancel_requested'].includes(account.order.status);
  openModal(`<div class="modal-label">내 주문 · 미리보기</div><h2 id="modal-title">주문 내역</h2>${responseRows(account.order)}<p>입금 확인 요청은 입금 완료와 달라요. 실제 운영 시 운영자가 입금 내역을 확인한 뒤 주문을 확정합니다.</p><p class="demo-notice">체험 주문이에요. 실제 주문 접수와 입금 확인은 아직 연결 전입니다.</p><div class="modal-actions">${needsDate ? '<button class="button primary" data-action="pickup-date">수령일 추가</button>' : ''}${editable ? '<button class="button primary" data-action="edit">주문서 수정</button>' : ''}${account.order.status !== 'cancelled' ? '<button class="button secondary" data-action="order">입금 안내</button>' : '<button class="button primary" data-action="go-form">새 주문서 작성</button>'}</div>${cancellable ? '<button class="danger-action" data-action="cancel-confirm">주문 취소 요청</button>' : ''}`);
}
function orderPreview() {
  const record = account.signedIn ? account.order : null;
  if(!record || record.status === 'cancelled') {openModal(`<div class="modal-label">입금 안내</div><h2 id="modal-title">주문서를 먼저 작성해주세요</h2><p>주문서를 제출하면 주문번호와 입금 안내를 확인할 수 있어요.</p><button class="button primary" data-action="go-form">주문서 작성</button>`);return;}
  openModal(`<div class="modal-label">입금 안내 · 미리보기</div><h2 id="modal-title">주문서 제출 다음 단계</h2><div class="order-progress"><span>주문서 제출</span><span>입금 안내</span><span>입금 확인</span></div>${responseRows(record)}<div class="payment-details"><p class="payment-bank-name"><strong>${escapeHTML(GROUP_BUY.bankAccount.bank)}</strong><span>예금주 ${escapeHTML(GROUP_BUY.bankAccount.holder)}</span></p><p class="payment-account-number">${escapeHTML(GROUP_BUY.bankAccount.number)}</p><div class="payment-copy-buttons"><button class="text-button" data-action="copy-account">계좌번호 복사</button><button class="text-button" data-action="copy-amount">입금 금액 복사</button></div><p class="payment-deadline">입금 기한: ${GROUP_BUY.paymentDeadlineLabel}<br>주문 마감: ${GROUP_BUY.ordersCloseLabel}</p></div><p class="demo-notice">현재는 미리보기예요. 실제 주문 접수·입금 확인이 연결되기 전에는 입금하지 마세요. ${paymentWindowOpen() ? '입금 기한은 ' + GROUP_BUY.paymentDeadlineLabel + '입니다.' : '입금 기한이 지났어요. 기한 내 입금 여부는 실제 입금 내역으로 확인해야 해요.'} 아래 버튼은 입금 확인 요청 상태만 체험합니다. 사용자 요청만으로 주문이 확정되지 않아요.</p><button class="button primary" data-action="payment-request" ${record.status !== 'payment_pending' ? 'disabled' : ''}>${record.status === 'payment_pending' ? '입금 확인 요청 · 체험' : ORDER_STATUS[record.status]}</button><button class="button secondary" data-action="my">내 주문 확인</button>`);
}
function addPickupDatePreview() {
  if(!account.signedIn || !account.order) {loginPreview('my');return;}
  const record = account.order;
  openModal(`<div class="modal-label">내 주문 · 미리보기</div><h2 id="modal-title">수령일을 선택해주세요</h2><p>${EVENTS[record.event].name}에서 수령할 날짜를 골라주세요. 주문번호와 입금 확인 상태는 그대로 유지돼요.</p><form id="add-pickup-date-form"><div class="pickup-days">${pickupDayChoices(record.event,record.pickupDate,'newPickupDate')}</div><button class="button primary" type="submit">수령일 저장</button><p class="field-error" id="pickup-date-error" role="alert"></p></form>`);
  $('#add-pickup-date-form').addEventListener('submit',event => {
    event.preventDefault();const date = new FormData(event.currentTarget).get('newPickupDate');
    try{const persisted = account.setPickupDate(date);refresh();myPreview();toast(persisted ? '수령일을 저장했어요.' : '저장이 제한되어 이번 화면에만 반영했어요.');}catch(error){$('#pickup-date-error').textContent=error.message;}
  });
}
function withdrawPreview() {
  if(!account.signedIn) {loginPreview();return;}
  openModal(`<div class="modal-label">내 계정 · 미리보기</div><h2 id="modal-title">회원탈퇴</h2><p><span class="nickname-display">${escapeHTML(nickname())}</span> 님의 미리보기 계정을 삭제합니다.</p><ul class="withdraw-list"><li>진행 중인 주문이 있으면 주문 처리 후 탈퇴할 수 있어요.</li><li>미리보기 로그인 상태가 해제돼요.</li><li>실제 카카오 계정과 연결되어 있지 않아 카카오 계정에는 영향을 주지 않아요.</li></ul><label class="withdraw-checkbox"><input id="withdraw-consent" type="checkbox"><span>미리보기 계정 삭제 시 닉네임, 취소된 체험 주문, 문의 대화가 삭제되는 점을 확인했어요.</span></label><p id="withdraw-error" class="field-error" role="alert"></p><div class="modal-actions"><button class="button secondary" data-action="close">취소</button><button class="button danger" id="withdraw-button" data-action="withdraw" disabled>탈퇴하기</button></div>`);
  const blocked = account.order && account.order.status !== 'cancelled';
  if(blocked) $('#withdraw-error').textContent = '진행 중인 주문이 있어요. 주문 처리 후 탈퇴할 수 있어요.';
  $('#withdraw-consent').addEventListener('change', () => $('#withdraw-button').disabled = !!blocked || !$('#withdraw-consent').checked);
}
async function copyPaymentValue(kind) {
  if(!account.signedIn || !account.order || account.order.status === 'cancelled') {toast('주문 내역을 먼저 확인해주세요.');return;}
  const isAccount = kind === 'account';
  const amount = account.order.totalAmount;
  if(!isAccount && !Number.isSafeInteger(amount)) {toast('입금 금액을 확인해주세요.');return;}
  const value = isAccount ? GROUP_BUY.bankAccount.number.replace(/\D/g,'') : String(amount);
  const label = isAccount ? '계좌번호' : '입금 금액';
  try {await navigator.clipboard.writeText(value);toast(`${label}을 복사했어요.`);}
  catch {
    openModal(`<div class="modal-label">입금 안내 · 미리보기</div><h2 id="modal-title">${label} 복사</h2><p>아래 값을 선택해 복사해주세요.</p><input id="payment-copy-value" class="share-link" readonly aria-label="${label}"><button class="button secondary" data-action="order">입금 안내로 돌아가기</button>`);
    $('#payment-copy-value').value=value;$('#payment-copy-value').focus();$('#payment-copy-value').select();
  }
}
async function share() {
  const url = new URL(location.href);url.hash = '';url.search = '';
  try {await navigator.clipboard.writeText(url.href);toast('미리보기 링크를 복사했어요.');}
  catch {openModal(`<div class="modal-label">링크 공유</div><h2 id="modal-title">주문 링크</h2><p>아래 링크를 복사해 공유해주세요. 현재는 디자인 시안이에요.</p><input id="share-link" class="share-link" aria-label="공유 링크" readonly><button class="button primary" data-action="select-share">링크 선택하기</button>`);$('#share-link').value = url.href;$('#share-link').select();}
}
function refreshInquiryBadge() {
  const count = account.signedIn ? inquiries.unread('user') : 0;
  document.querySelectorAll('[data-inquiry-count]').forEach(badge => {badge.hidden = !count;badge.textContent = String(count);});
}
function messagePreview(viewer = 'user') {
  if(!account.signedIn) {loginPreview('message');return;}
  const operator = viewer === 'operator';
  inquiries.markRead(viewer);
  refreshInquiryBadge();
  openModal(`<div class="modal-label">${operator ? '운영자 답변 화면 · 미리보기' : '운영자에게 문의'}</div><h2 id="modal-title">${operator ? escapeHTML(nickname()) + ' 님과의 대화' : '문의 메시지'}</h2><p class="message-preview-note">이 브라우저에서만 체험하는 대화예요. 운영자에게 실제로 전달되지 않습니다.</p><div class="message-history" id="message-history" role="log" aria-live="polite" aria-label="문의 대화"></div><form id="message-form" class="message-compose"><label class="sr-only" for="message-input">${operator ? '운영자 답변' : '문의 내용'}</label><textarea id="message-input" rows="3" maxlength="1000" placeholder="${operator ? '답변을 입력해주세요' : '궁금한 점을 남겨주세요'}" aria-describedby="message-count message-error"></textarea><div class="message-compose-bottom"><span id="message-count">0 / 500</span><button type="submit" class="button lime" id="message-send">${operator ? '답변 보내기' : '보내기'}</button></div><p id="message-error" class="field-error" role="alert"></p></form><div class="message-view-switch"><button type="button" class="text-button" data-action="${operator ? 'message' : 'message-operator'}">${operator ? '사용자 화면으로 돌아가기' : '운영자 답변 화면 체험'}</button></div>`);
  modal.classList.add('modal-messages');
  const history = $('#message-history');
  function renderHistory() {
    if(!inquiries.messages.length) {history.innerHTML='<p class="message-empty">수령·주문 관련 궁금한 점을 남겨주세요.<br>답변은 이 대화에서 확인할 수 있어요.</p>';return;}
    let day = '';
    history.innerHTML = inquiries.messages.map(m => {
      const date = new Date(m.createdAt);
      const currentDay = date.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
      const divider = currentDay !== day ? `<p class="message-day">${currentDay}</p>` : '';day=currentDay;
      const mine = m.sender === viewer;
      const time = date.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
      return divider + `<div class="message-row ${mine ? 'outgoing' : 'incoming'}"><span class="message-sender">${m.sender === 'operator' ? '운영자' : escapeHTML(nickname())}</span><div class="message-bubble">${escapeHTML(m.text)}</div><span class="message-meta">${mine ? (m.read ? '읽음 · ' : '보냄 · ') : '받음 · '}${time}</span></div>`;
    }).join('');
    history.scrollTop = history.scrollHeight;
  }
  renderHistory();
  const input = $('#message-input'), send = $('#message-send');
  function updateCount() {const count=Array.from(input.value).length;$('#message-count').textContent=`${count} / 500`;$('#message-count').classList.toggle('over-limit',count>500);send.disabled=!input.value.trim()||count>500;$('#message-error').textContent='';}
  input.addEventListener('input', updateCount);updateCount();
  $('#message-form').addEventListener('submit', event => {
    event.preventDefault();
    if(!account.signedIn) {loginPreview('message');return;}
    try {
      const {persisted} = inquiries.send(viewer,validateMessage(input.value));
      input.value='';updateCount();renderHistory();refreshInquiryBadge();
      if(!persisted) $('#message-error').textContent='브라우저 저장이 제한돼 이번 화면에서만 확인할 수 있어요.';
      input.focus({preventScroll:true});
    } catch(error) {$('#message-error').textContent=error.message;}
  });
}
document.addEventListener('click', event => {
  if(!$('#account-area').contains(event.target)) toggleMenu(false);
  const button = event.target.closest('[data-action]');if(!button) return;
  toggleMenu(false);
  switch(button.dataset.action) {
    case 'login': loginPreview();break;
    case 'demo-auth': completeDemoAuth();break;
    case 'nickname-edit': nicknameForm();break;
    case 'logout': account.logout();clearDraft();refresh();closeModal();toast('로그아웃했어요. 주문 내역은 유지돼요.');$('#header-login').focus();break;
    case 'withdraw-confirm': withdrawPreview();break;
    case 'withdraw':
      if(!$('#withdraw-consent')?.checked) return;
      try {if(!account.signedIn) throw new Error('로그인해주세요.');if(account.order && account.order.status !== 'cancelled') throw new Error('진행 중인 주문이 있어요. 주문 처리 후 탈퇴할 수 있어요.');inquiries.clear();account.withdraw();clearDraft();refresh();closeModal();toast('미리보기 계정을 삭제했어요.');$('#header-login').focus();}
      catch(error) {$('#withdraw-error').textContent = error.message || '삭제를 완료하지 못했어요.';}
      break;
    case 'my': myPreview();break;
    case 'message': messagePreview();break;
    case 'message-operator': messagePreview('operator');break;
    case 'pickup-date': addPickupDatePreview();break;
    case 'order': orderPreview();break;
    case 'copy-account': copyPaymentValue('account');break;
    case 'copy-amount': copyPaymentValue('amount');break;
    case 'payment-request':
      try {const persisted = account.requestPaymentCheck();refresh();myPreview();toast(persisted ? '입금 확인 요청 상태로 변경했어요. 실제 입금 확인은 아닙니다.' : '저장이 제한되어 이번 화면에만 반영했어요.');}catch(error){toast(error.message);}break;
    case 'edit':
      if(!account.signedIn) loginPreview('my');
      else if(!ordersOpen() || account.order?.status !== 'payment_pending') toast('현재 상태에서는 주문서를 수정할 수 없어요.');
      else {setDraft(account.order);goToForm();toast('주문서를 변경하고 수정 버튼을 눌러주세요.');}break;
    case 'go-form': if(account.order?.status === 'cancelled') clearDraft();goToForm();break;
    case 'cancel-confirm':
      if(!account.signedIn) {loginPreview('my');break;}
      openModal(`<div class="modal-label">내 주문</div><h2 id="modal-title">체험 주문 취소</h2><p>마감 전 입금 대기 상태이면 체험 주문을 취소해요. 입금 확인 요청 이후 또는 주문 마감 후에는 운영자 확인이 필요한 취소 요청으로 남겨요. 주문 기록은 삭제하지 않아요.</p><div class="modal-actions"><button class="button secondary" data-action="my">돌아가기</button><button class="button primary" data-action="cancel">취소 요청</button></div>`);break;
    case 'cancel':
      try {const persisted = account.cancelOrder();refresh();myPreview();toast(persisted ? (account.order.status === 'cancelled' ? '체험 주문을 취소했어요.' : '취소 확인 요청으로 남겼어요.') : '브라우저 저장이 제한되어 이번 화면에만 반영됐어요.');}catch(error) {toast(error.message);}break;
    case 'close': closeModal();break;
    case 'design': openModal(`<div class="modal-label">슬로건 디자인</div><h2 id="modal-title">춤은 불법이 아니다</h2><div class="design-gallery"><div class="towel-crop back"><img src="/assets/slogan.png" alt="춤추는 해골 패턴 면"></div><div class="towel-crop front"><img src="/assets/slogan.png" alt="춤은 불법이 아니다 문구 면"></div></div><p>소재·크기·인쇄 사양은 제작 조건 확인 후 안내할 예정이에요.</p>`, {wide:true});break;
    case 'share': share();break;
    case 'select-share': $('#share-link').focus();$('#share-link').select();break;
    case 'about': openModal(`<div class="modal-label">디자인 시안</div><h2 id="modal-title">미리보기 안내</h2><p>주문서 제출과 입금 안내, 계정과 문의 대화 흐름을 확인할 수 있는 시안이에요.</p><div class="modal-detail-table"><div><span>계정 흐름</span><strong>닉네임 설정·수정, 로그아웃, 탈퇴</strong></div><div><span>주문 흐름</span><strong>주문서 작성·입금 확인 요청·수정·취소</strong></div><div><span>수령</span><strong>경기인디뮤직페스티벌 / 세종보헤미안뮤직페스티벌 현장</strong></div><div><span>문의 흐름</span><strong>500자 메시지·운영자 답변·읽음 표시</strong></div><div><span>아직 연결 전</span><strong>카카오 인증·주문 DB·입금 확인·문의 전달</strong></div></div><p class="demo-notice">닉네임과 체험 주문은 현재 브라우저에만 저장돼요. 진행 중인 체험 주문이 있으면 탈퇴를 막아요. 실제 운영 시 주문 기록 보관과 환불·탈퇴 처리는 서버에서 관리해야 해요.</p><button class="button primary" data-action="close">닫기</button>`);break;
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
document.addEventListener('visibilitychange',() => {updateCountdown();refresh();});
setInterval(() => refresh(),30000);
