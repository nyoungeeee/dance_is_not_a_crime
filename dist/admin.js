import {api} from './api.mjs?v=1';
import {EVENTS, pickupDateLabel} from './account-state.mjs?v=13';
import {ORDER_STATUS} from './group-buy.mjs?v=13';
// 운영자 화면. 권한은 서버가 검사한다(ADMIN_KAKAO_IDS). 이 파일은 공개돼도 데이터는 운영자에게만 내려온다.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const time = iso => new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let orders = [], threads = [], currentThread = null, toastTimer;
function toast(m) {$('#toast').textContent = m;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);}

for (const [value, label] of Object.entries(ORDER_STATUS)) $('#status-filter').insertAdjacentHTML('beforeend', `<option value="${value}">${label}</option>`);

function renderSummary() {
  const count = s => orders.filter(o => o.status === s).length;
  const paid = orders.filter(o => ['paid','picked_up'].includes(o.status));
  const live = orders.filter(o => !['cancelled','refunded'].includes(o.status));
  const byDate = {};
  for (const o of paid) {const k = `${EVENTS[o.event]?.name ?? o.event} ${pickupDateLabel(o.event, o.pickupDate)}`;byDate[k] = (byDate[k] || 0) + o.quantity;}
  $('#summary').innerHTML = [
    ['입금 확인 요청', `${count('verification_requested')}건`],
    ['입금 대기', `${count('payment_pending')}건`],
    ['취소 확인 요청', `${count('cancel_requested')}건`],
    ['진행 중 주문 수량', `${live.reduce((a, o) => a + o.quantity, 0)}개`],
    ['입금 확인 완료', `${paid.length}건 · ${paid.reduce((a, o) => a + o.quantity, 0)}개 · ${won(paid.reduce((a, o) => a + o.totalAmount, 0))}`],
    ...Object.entries(byDate).map(([k, q]) => [`수령 ${k}`, `${q}개`]),
  ].map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}
function renderOrders() {
  const status = $('#status-filter').value, q = $('#search').value.trim().toLowerCase();
  const rows = orders.filter(o => (!status || o.status === status) && (!q || [o.id, o.nickname, o.payerName].some(v => v.toLowerCase().includes(q))));
  $('#order-rows').innerHTML = rows.map(o => `<tr data-id="${esc(o.id)}">
    <td>${esc(o.id)}<details><summary>기록 ${o.logs.length}</summary><ol>${o.logs.map(l => `<li>${time(l.createdAt)} ${l.actor === 'admin' ? '운영자' : '사용자'} → ${esc(ORDER_STATUS[l.toStatus] ?? l.toStatus)}${l.note ? ` · ${esc(l.note)}` : ''}</li>`).join('')}</ol></details></td>
    <td>${esc(o.nickname)}</td><td><strong>${esc(o.payerName)}</strong></td><td class="num">${o.quantity}</td><td class="num">${won(o.totalAmount)}</td>
    <td>${esc(EVENTS[o.event]?.name ?? o.event)}<br><small class="muted">${esc(pickupDateLabel(o.event, o.pickupDate))}</small></td>
    <td><span class="status s-${esc(o.status)}">${esc(ORDER_STATUS[o.status] ?? o.status)}</span></td><td>${time(o.createdAt)}</td>
    <td><div class="act"><select aria-label="바꿀 상태">${Object.entries(ORDER_STATUS).map(([v, l]) => `<option value="${v}" ${v === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select><input placeholder="메모 (예: 입금 확인)" maxlength="200" aria-label="메모"><button class="primary" data-save>저장</button></div></td>
  </tr>`).join('') || '<tr><td colspan="9" class="muted">주문이 없어요.</td></tr>';
}
async function loadOrders() {
  orders = (await api('GET', '/api/admin/orders')).orders;
  renderSummary();renderOrders();
}
$('#status-filter').addEventListener('change', renderOrders);
$('#search').addEventListener('input', renderOrders);
$('#reload').addEventListener('click', () => loadOrders().then(() => toast('새로고침했어요.')).catch(e => toast(e.message)));
$('#order-rows').addEventListener('click', async e => {
  const btn = e.target.closest('[data-save]');if (!btn) return;
  const row = btn.closest('tr'), id = row.dataset.id, status = row.querySelector('select').value, note = row.querySelector('input').value;
  const order = orders.find(o => o.id === id);
  if (status === order.status && !note) {toast('바뀐 내용이 없어요.');return;}
  if (!confirm(`${id} (${order.payerName}, ${won(order.totalAmount)})\n${ORDER_STATUS[order.status]} → ${ORDER_STATUS[status]}\n저장할까요?`)) return;
  btn.disabled = true;
  try {await api('POST', `/api/admin/orders/${encodeURIComponent(id)}/status`, {status, note});await loadOrders();toast('저장했어요.');}
  catch (err) {toast(err.message);btn.disabled = false;}
});
$('#csv').addEventListener('click', () => {
  const head = ['주문번호','닉네임','입금자명','수량','금액','행사','수령일','상태','접수시각','수정시각'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head, ...orders.map(o => [o.id, o.nickname, o.payerName, o.quantity, o.totalAmount, EVENTS[o.event]?.name ?? o.event, o.pickupDate ?? '', ORDER_STATUS[o.status] ?? o.status, time(o.createdAt), time(o.updatedAt)])].map(r => r.map(cell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`orders-${new Date().toISOString().slice(0,10)}.csv`});
  a.click();URL.revokeObjectURL(a.href);
});

function renderThreads() {
  const unread = threads.reduce((a, t) => a + t.unread, 0);
  $('#thread-unread').hidden = !unread;$('#thread-unread').textContent = unread;
  $('#thread-list').innerHTML = threads.map(t => `<li><button data-user="${t.userId}" class="${t.userId === currentThread ? 'active' : ''}"><strong>${esc(t.nickname ?? '(닉네임 없음)')}${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</strong><span>${t.lastMessage ? `${t.lastMessage.sender === 'operator' ? '나: ' : ''}${esc(t.lastMessage.text)}` : ''}</span></button></li>`).join('') || '<li class="muted" style="padding:12px">문의가 없어요.</li>';
}
async function loadThreads() {threads = (await api('GET', '/api/admin/threads')).threads;renderThreads();}
async function openThread(userId) {
  currentThread = userId;
  const {user, messages} = await api('GET', `/api/admin/threads/${userId}`);
  $('#thread-view').innerHTML = `<strong>${esc(user.nickname)}</strong><div class="msgs">${messages.map(m => `<div class="msg ${m.sender === 'operator' ? 'op' : ''}">${esc(m.text)}<small>${m.sender === 'operator' ? '운영자' : esc(user.nickname)} · ${time(m.createdAt)}${m.sender === 'operator' ? (m.read ? ' · 읽음' : ' · 안 읽음') : ''}</small></div>`).join('')}</div><form class="reply"><textarea maxlength="1000" placeholder="답변 (500자 이내)" required></textarea><button class="primary">보내기</button></form>`;
  const box = $('#thread-view .msgs');box.scrollTop = box.scrollHeight;
  await loadThreads();
}
$('#thread-list').addEventListener('click', e => {const b = e.target.closest('[data-user]');if (b) openThread(Number(b.dataset.user)).catch(err => toast(err.message));});
$('#thread-view').addEventListener('submit', async e => {
  e.preventDefault();
  const ta = e.target.querySelector('textarea'), btn = e.target.querySelector('button');
  if ([...ta.value.trim()].length > 500) {toast('500자 이내로 입력해주세요.');return;}
  btn.disabled = true;
  try {await api('POST', `/api/admin/threads/${currentThread}`, {text:ta.value});await openThread(currentThread);}
  catch (err) {toast(err.message);btn.disabled = false;}
});

document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === t));
  $('#orders').hidden = t.dataset.tab !== 'orders';$('#threads').hidden = t.dataset.tab !== 'threads';
  (t.dataset.tab === 'orders' ? loadOrders() : loadThreads()).catch(e => toast(e.message));
}));

(async () => {
  const me = await api('GET', '/api/me').catch(() => ({user:null}));
  if (!me.user) {$('#gate').innerHTML = '운영자 계정으로 <a href="/api/auth/kakao/login?intent=admin">카카오 로그인</a>해주세요.';return;}
  if (!me.user.isAdmin) {$('#gate').innerHTML = '운영자로 등록된 계정이 아니에요. <a href="/">주문 페이지로 돌아가기</a>';return;}
  $('#gate').hidden = true;$('#orders').hidden = false;$('#who').textContent = `${me.user.nickname ?? ''} 님`;
  await Promise.all([loadOrders(), loadThreads()]).catch(e => toast(e.message));
  // 열어 둔 동안 1분마다 갱신(입력 중인 메모를 지우지 않도록 주문 표는 포커스가 없을 때만)
  setInterval(() => {
    if (document.hidden) return;
    if (!$('#orders').hidden && !document.activeElement?.closest('#order-rows')) loadOrders().catch(() => {});
    loadThreads().catch(() => {});
  }, 60000);
})();
