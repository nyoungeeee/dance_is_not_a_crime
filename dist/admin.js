import {api} from './api.mjs?v=2';
import {EVENTS, pickupDateLabel} from './account-state.mjs?v=14';
import {GROUP_BUY, ORDER_STATUS} from './group-buy.mjs?v=15';
// 운영자 화면. 권한은 서버가 검사한다(ADMIN_KAKAO_IDS). 이 파일은 공개돼도 데이터는 운영자에게만 내려온다.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const time = iso => new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let orders = [], threads = [], currentThread = null, toastTimer;
/** 요청 중 버튼에 스피너를 띄우고 막는다. */
async function busy(btn, task) {
  if (btn.disabled) return;
  btn.disabled = true;
  const sp = Object.assign(document.createElement('span'), {className:'spinner'});
  btn.prepend(sp);
  try {return await task();}
  finally {sp.remove();if (btn.isConnected) btn.disabled = false;}
}
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
    ['진행 중 주문 수량 (최소 50개)', `${live.reduce((a, o) => a + o.quantity, 0)}개 / ${GROUP_BUY.minTotalQuantity}개`],
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
  await busy(btn, async () => {
    try {await api('POST', `/api/admin/orders/${encodeURIComponent(id)}/status`, {status, note});await loadOrders();toast('저장했어요.');}
    catch (err) {toast(err.message);}
  });
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
  await busy(btn, async () => {
    try {await api('POST', `/api/admin/threads/${currentThread}`, {text:ta.value});await openThread(currentThread);}
    catch (err) {toast(err.message);}
  });
});

// 정산: 돈이 오간 내역. 주문 입금 합계는 서버가 주문 상태로 계산한다.
const LEDGER_KIND = {vendor_payment:['업체 결제',-1], advance:['운영자 개인 자금 투입',1], reimburse:['개인 자금 돌려받음',-1], other_in:['기타 수입',1], other_out:['기타 지출',-1]};
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}원`;
const dayTime = iso => new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let ledger = null;
function renderLedger() {
  const {summary:s, entries} = ledger;
  const rows = [
    ['주문 입금 (입금 확인 완료)', s.orderIncome.amount, `${s.orderIncome.count}건 · ${s.orderIncome.quantity}개`],
    ['운영자 개인 자금 투입', s.advance, ''],
    s.otherIn ? ['기타 수입', s.otherIn, ''] : null,
    ['업체 결제', -s.vendor.amount, s.vendor.quantity ? `${s.vendor.quantity}개` : ''],
    s.reimbursed ? ['개인 자금 돌려받음', -s.reimbursed, ''] : null,
    s.otherOut ? ['기타 지출', -s.otherOut, ''] : null,
  ].filter(Boolean);
  $('#flow').innerHTML = `<h3>돈 흐름</h3>${rows.map(([k, v, sub]) => `<div class="flow-row"><span>${esc(k)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><strong class="${v < 0 ? 'out' : 'in'}">${signed(v)}</strong></div>`).join('')}
    <div class="flow-row total"><span>공구 통장 잔액 (계산)<small>실제 통장 잔액과 맞는지 확인하세요</small></span><strong>${won(s.balance)}</strong></div>`;
  $('#flow-notes').innerHTML = [
    ['아직 돌려받지 않은 개인 자금', won(s.outstandingAdvance), s.outstandingAdvance > 0 ? '이후 들어오는 주문 입금으로 돌려받을 돈' : ''],
    ['발주 수량 − 입금 확인 수량', `${s.unmatchedQuantity}개`, s.unmatchedQuantity > 0 ? '예비·미입금·추후 주문분' : s.unmatchedQuantity < 0 ? '입금 확인 수량이 발주보다 많아요. 추가 발주가 필요해요' : ''],
  ].map(([k, v, sub]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('');
  $('#ledger-rows').innerHTML = entries.map(e => {
    const [label, sign] = LEDGER_KIND[e.kind] ?? [e.kind, 1];
    return `<tr><td>${dayTime(e.occurredAt)}</td><td>${esc(label)}</td><td class="num ${sign < 0 ? 'out' : 'in'}">${signed(sign * e.amount)}</td><td class="num">${e.quantity ?? ''}</td><td>${esc(e.memo)}</td><td><button class="ghost small" data-del="${e.id}">삭제</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">아직 적은 내역이 없어요. 위에서 업체 결제, 개인 자금 투입 등을 추가하세요.</td></tr>';
}
async function loadLedger() {ledger = await api('GET', '/api/admin/ledger');renderLedger();}
{
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16);
  $('#ledger-form [name=occurredAt]').value = now;
}
const toInt = v => {const t = String(v).replace(/[,\s원개]/g, '');return t === '' ? null : /^\d+$/.test(t) ? Number(t) : NaN;};
$('#ledger-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  const body = {kind:f.kind.value, occurredAt:`${f.occurredAt.value}:00+09:00`, amount:toInt(f.amount.value), quantity:toInt(f.quantity.value), memo:f.memo.value};
  if (!Number.isInteger(body.amount) || body.amount < 1) {toast('금액을 숫자로 입력해주세요.');return;}
  if (Number.isNaN(body.quantity)) {toast('수량은 숫자로 입력해주세요.');return;}
  const [label, sign] = LEDGER_KIND[body.kind];
  if (!confirm(`${label} ${signed(sign * body.amount)}${body.quantity !== null ? ` · ${body.quantity}개` : ''}\n추가할까요?`)) return;
  await busy(btn, async () => {
    try {await api('POST', '/api/admin/ledger', body);f.amount.value = f.quantity.value = f.memo.value = '';await loadLedger();toast('추가했어요.');}
    catch (err) {toast(err.message);}
  });
});
$('#ledger-rows').addEventListener('click', async e => {
  const btn = e.target.closest('[data-del]');if (!btn) return;
  const entry = ledger.entries.find(x => x.id === Number(btn.dataset.del));
  if (!confirm(`${LEDGER_KIND[entry.kind]?.[0] ?? entry.kind} ${won(entry.amount)} 내역을 지울까요?`)) return;
  await busy(btn, async () => {
    try {await api('DELETE', `/api/admin/ledger/${entry.id}`);await loadLedger();toast('지웠어요.');}
    catch (err) {toast(err.message);}
  });
});

document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === t));
  for (const id of ['orders','threads','ledger']) $(`#${id}`).hidden = t.dataset.tab !== id;
  ({orders:loadOrders, threads:loadThreads, ledger:loadLedger})[t.dataset.tab]().catch(e => toast(e.message));
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
