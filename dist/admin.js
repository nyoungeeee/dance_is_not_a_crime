import {api} from './api.mjs?v=2';
import {EVENTS, pickupDateLabel} from './account-state.mjs?v=18';
import {GROUP_BUY, CURRENT_ROUND, ORDER_STATUS} from './group-buy.mjs?v=21';
// 운영자 화면. 권한은 서버가 검사한다(ADMIN_KAKAO_IDS). 이 파일은 공개돼도 데이터는 운영자에게만 내려온다.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const time = iso => new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
// allOrders: 서버에서 받은 전체. orders: 상단에서 고른 행사(수령 행사 기준)의 주문만. 주문·현장 수령 탭은 orders만 본다.
let allOrders = [], orders = [], threads = [], currentThread = null, toastTimer;
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
const CLOSED = ['cancelled','refunded','picked_up','forfeited'];
const ROUND_LABEL = {1:'1차 경기', 2:'2차 세종'};
/**
 * 행사별 관리: 세종(2차 + 세종으로 옮긴 1차 이월분) / 인뮤페(경기 수령일로 남은 1차 주문). 문의·정산 탭은 행사와 상관없이 하나.
 * 고른 행사는 이 브라우저에 기억한다.
 */
const SCOPES = {sejong:'세종', inmufe:'인뮤페'};
let scope = 'sejong';
try {const saved = localStorage.getItem('admin-scope');if (Object.hasOwn(SCOPES, saved)) scope = saved;} catch {}
function applyScope() {
  orders = allOrders.filter(o => o.event === scope);
  document.querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  document.body.dataset.scope = scope;
  document.title = `운영자 화면 · ${SCOPES[scope]} | 춤은 불법이 아니다`;
}
/** 1차(경기) 주문을 세종 수령일로 옮긴 것. 현장 수령·명단에서 구분해 보여준다. */
const carried = o => o.round === 1 && o.event !== 'inmufe';
// 수령 변경에 고를 수 있는 모든 행사·날짜("행사|날짜")
const PICKUP_CHOICES = Object.entries(EVENTS).flatMap(([event, e]) => e.dates.map(d => [`${event}|${d.value}`, `${e.name} ${d.label}`]));

function renderSummary() {
  // 고른 행사 기준. 진행 조건(50개)은 지금 받는 차수(세종 2차) 주문만 센다(1차 이월분 제외).
  const list = orders;
  const count = s => list.filter(o => o.status === s).length;
  // 입금 확인 완료 합계에는 수령 포기(입금은 받음)도 넣는다. 수령일별 수량은 실제로 나눠 줄 것만.
  const paid = list.filter(o => ['paid','picked_up','forfeited'].includes(o.status));
  const live = list.filter(o => !['cancelled','refunded'].includes(o.status));
  const byDate = {};
  for (const o of list.filter(o => ['paid','picked_up'].includes(o.status))) {const k = `${EVENTS[o.event]?.name ?? o.event} ${pickupDateLabel(o.event, o.pickupDate)}`;byDate[k] = (byDate[k] || 0) + o.quantity;}
  $('#summary').innerHTML = [
    ['입금 확인 요청', `${count('verification_requested')}건`],
    ['입금 대기', `${count('payment_pending')}건`],
    ['취소 확인 요청', `${count('cancel_requested')}건`],
    scope === 'sejong'
      ? ['2차 진행 중 주문 수량 (최소 50개)', `${live.filter(o => o.round === CURRENT_ROUND).reduce((a, o) => a + o.quantity, 0)}개 / ${GROUP_BUY.minTotalQuantity}개`]
      : ['진행 중 주문 수량', `${live.reduce((a, o) => a + o.quantity, 0)}개`],
    scope === 'sejong' && ['다음 청원 참여 동의', `${new Set(live.filter(o => o.logs.some(l => l.note?.includes('다음 청원 참여 동의'))).map(o => o.userId)).size}명`],
    ['입금 확인 완료', `${paid.length}건 · ${paid.reduce((a, o) => a + o.quantity, 0)}개 · ${won(paid.reduce((a, o) => a + o.totalAmount, 0))}`],
    ...Object.entries(byDate).map(([k, q]) => [`수령 ${k}`, `${q}개`]),
  ].filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}
function renderOrders() {
  const status = $('#status-filter').value, q = $('#search').value.trim().toLowerCase();
  const rows = orders.filter(o => (!status || o.status === status) && (!q || [o.id, o.nickname, o.payerName].some(v => v.toLowerCase().includes(q))));
  shownRows = rows;
  $('#order-rows').innerHTML = rows.map(o => `<tr data-id="${esc(o.id)}" class="${picked.has(o.id) ? 'is-picked' : ''}">
    <td class="pick"><input type="checkbox" data-pick-order="${esc(o.id)}" ${picked.has(o.id) ? 'checked' : ''} aria-label="${esc(o.nickname)} ${esc(o.id)} 선택"></td>
    <td>${esc(o.id)} <small class="muted">${o.round}차</small><details><summary>기록 ${o.logs.length}</summary><ol>${o.logs.map(l => `<li>${time(l.createdAt)} ${l.actor === 'admin' ? '운영자' : '사용자'}${l.fromStatus === l.toStatus ? '' : ` → ${esc(ORDER_STATUS[l.toStatus] ?? l.toStatus)}`}${l.note ? ` · ${esc(l.note)}` : ''}</li>`).join('')}</ol></details></td>
    <td>${esc(o.nickname)}</td><td><strong>${esc(o.payerName)}</strong></td><td class="num">${o.quantity}</td><td class="num">${won(o.totalAmount)}</td>
    <td>${esc(EVENTS[o.event]?.name ?? o.event)}<br><small class="muted">${esc(pickupDateLabel(o.event, o.pickupDate))}${carried(o) ? ' · 1차 이월' : ''}</small></td>
    <td><span class="status s-${esc(o.status)}">${esc(ORDER_STATUS[o.status] ?? o.status)}</span></td><td>${time(o.createdAt)}</td>
    <td><div class="act"><select aria-label="바꿀 상태">${Object.entries(ORDER_STATUS).map(([v, l]) => `<option value="${v}" ${v === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select><input placeholder="메모 (예: 입금 확인)" maxlength="200" aria-label="메모"><button class="primary" data-save>저장</button></div>${CLOSED.includes(o.status) ? '' : `<div class="act move"><select aria-label="바꿀 수령일" data-pickup>${PICKUP_CHOICES.map(([v, l]) => `<option value="${v}" ${v === `${o.event}|${o.pickupDate}` ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><button class="ghost" data-move>수령 변경</button></div>`}</td>
  </tr>`).join('') || '<tr><td colspan="10" class="muted">주문이 없어요.</td></tr>';
  renderBulk();
}
// 단체 메시지: 주문을 골라(사람 단위로 한 번씩) 각자의 문의 대화로 보낸다. 치환·검사는 서버가 한다.
const picked = new Set();
let shownRows = [];
function renderBulk() {
  for (const id of [...picked]) if (!orders.some(o => o.id === id)) picked.delete(id);
  const people = new Set(orders.filter(o => picked.has(o.id)).map(o => o.userId)).size;
  $('#bulk').hidden = !picked.size;
  $('#bulk-count').textContent = `${picked.size}건 선택 · ${people}명에게 보내요`;
  const all = $('#pick-all'), shown = shownRows.filter(o => picked.has(o.id)).length;
  all.checked = shownRows.length > 0 && shown === shownRows.length;
  all.indeterminate = shown > 0 && shown < shownRows.length;
}
function bulkPreview() {
  const mine = orders.filter(o => picked.has(o.id)), first = mine[0];
  const ofFirst = mine.filter(o => o.userId === first.userId);
  return $('#bulk-text').value.trim().replaceAll('{닉네임}', first.nickname).replaceAll('{주문}', ofFirst.map(o => `${o.id} ${o.quantity}개`).join(', '));
}
$('#order-rows').addEventListener('change', e => {
  const box = e.target.closest('[data-pick-order]');if (!box) return;
  box.checked ? picked.add(box.dataset.pickOrder) : picked.delete(box.dataset.pickOrder);
  box.closest('tr').classList.toggle('is-picked', box.checked);
  renderBulk();
});
$('#pick-all').addEventListener('change', e => {
  for (const o of shownRows) e.target.checked ? picked.add(o.id) : picked.delete(o.id);
  renderOrders();
});
$('#bulk-clear').addEventListener('click', () => {picked.clear();renderOrders();});
$('#bulk-text').addEventListener('input', () => {const n = [...$('#bulk-text').value.trim()].length;$('#bulk-len').textContent = `${n} / 500`;$('#bulk-len').classList.toggle('over', n > 500);});
$('#bulk').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#bulk-text').value.trim(), btn = $('#bulk-send');
  if (!text) {toast('보낼 메시지를 입력해주세요.');return;}
  const people = new Set(orders.filter(o => picked.has(o.id)).map(o => o.userId)).size;
  if (!confirm(`${people}명에게 보낼까요? 보낸 메시지는 지울 수 없어요.\n\n첫 번째 사람에게 가는 내용:\n${bulkPreview()}`)) return;
  await busy(btn, async () => {
    try {
      const r = await api('POST', '/api/admin/messages', {orderIds:[...picked], text});
      toast(`${r.sent}명에게 보냈어요.${r.skipped ? ` 탈퇴한 ${r.skipped}명은 건너뛰었어요.` : ''}`);
      picked.clear();$('#bulk-text').value = '';$('#bulk-len').textContent = '0 / 500';
      renderOrders();loadThreads().catch(() => {});
    } catch (err) {toast(err.message);}
  });
});
async function loadOrders() {
  allOrders = (await api('GET', '/api/admin/orders')).orders;
  applyScope();
  renderSummary();renderOrders();renderPickup();
}
$('#status-filter').addEventListener('change', renderOrders);
document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
  if (scope === b.dataset.scope) return;
  scope = b.dataset.scope;
  try {localStorage.setItem('admin-scope', scope);} catch {}
  applyScope();fillPrintDates();picked.clear();
  $('#pk-q').value = '';pickedUser = null;
  renderSummary();renderOrders();renderPickup();
}));
$('#search').addEventListener('input', renderOrders);
$('#reload').addEventListener('click', () => loadOrders().then(() => toast('새로고침했어요.')).catch(e => toast(e.message)));
// 수령 변경: 1차 경기 미수령분을 문의로 받은 세종 날짜로 옮길 때 쓴다. 메모 칸에 적은 내용이 기록에 같이 남는다.
$('#order-rows').addEventListener('click', async e => {
  const btn = e.target.closest('[data-move]');if (!btn) return;
  const row = btn.closest('tr'), id = row.dataset.id, order = orders.find(o => o.id === id);
  const [event, pickupDate] = row.querySelector('[data-pickup]').value.split('|'), note = row.querySelector('.act input').value;
  if (event === order.event && pickupDate === order.pickupDate) {toast('바뀐 수령일이 없어요.');return;}
  if (!confirm(`${id} (${order.nickname}, ${order.quantity}개, ${ORDER_STATUS[order.status]})\n${EVENTS[order.event]?.name ?? order.event} ${pickupDateLabel(order.event, order.pickupDate)} → ${EVENTS[event].name} ${pickupDateLabel(event, pickupDate)}\n수령일을 바꿀까요?`)) return;
  await busy(btn, async () => {
    try {await api('POST', `/api/admin/orders/${encodeURIComponent(id)}/pickup`, {event, pickupDate, note});await loadOrders();toast('수령일을 바꿨어요.');}
    catch (err) {toast(err.message);}
  });
});
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
  const head = ['주문번호','차수','닉네임','입금자명','수량','금액','행사','수령일','상태','접수시각','수정시각'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head, ...orders.map(o => [o.id, ROUND_LABEL[o.round] ?? o.round, o.nickname, o.payerName, o.quantity, o.totalAmount, EVENTS[o.event]?.name ?? o.event, o.pickupDate ?? '', ORDER_STATUS[o.status] ?? o.status, time(o.createdAt), time(o.updatedAt)])].map(r => r.map(cell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:`orders-${scope}-${new Date().toISOString().slice(0,10)}.csv`});
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

// 현장 수령: 사람 단위로 찾아서 입금 확인 완료 주문만 한 번에 전달 완료로 바꾼다. 상태 검사는 서버가 다시 한다.
const PENDING = ['payment_pending','verification_requested'];
const kstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const sumQty = list => list.reduce((a, o) => a + o.quantity, 0);
const dayLabel = date => Object.values(EVENTS).flatMap(e => e.dates).find(d => d.value === date)?.label ?? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const pickedAt = o => [...o.logs].reverse().find(l => l.toStatus === 'picked_up')?.createdAt;
/** 고객이 보여주는 주문번호와 맞춰 보기 쉽게 끝 4자리를 굵게. */
const idHTML = id => `${esc(id.slice(0, -4))}<b>${esc(id.slice(-4))}</b>`;
let undoTimer = null;
function personOf(userId) {
  const mine = orders.filter(o => o.userId === userId);
  return {
    userId, orders:mine,
    nickname:mine.at(-1)?.nickname ?? '',
    payers:[...new Set(mine.map(o => o.payerName))],
    give:mine.filter(o => o.status === 'paid'),
    done:mine.filter(o => o.status === 'picked_up'),
    unpaid:mine.filter(o => PENDING.includes(o.status)),
  };
}
function renderPickupStats() {
  const today = kstDay(), live = orders.filter(o => ['paid','picked_up'].includes(o.status));
  const todays = live.filter(o => o.pickupDate === today), done = o => o.status === 'picked_up';
  const waiting = new Set(todays.filter(o => !done(o)).map(o => o.userId)).size;
  $('#pk-stats').innerHTML = [
    [`오늘 ${dayLabel(today)}`, `${sumQty(todays.filter(done))}/${sumQty(todays)}개`, `전달 · 남은 ${waiting}명`],
    ['전체', `${sumQty(live.filter(done))}/${sumQty(live)}개`, '전달'],
    ['입금 미확인', `${orders.filter(o => PENDING.includes(o.status)).length}건`, '전달 금지'],
  ].map(([k, v, sub]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong><small>${esc(sub)}</small></div>`).join('');
}
/** 색은 두 가지만: 하늘색 = 누를 버튼, 빨강 = 주면 안 되는 것. 나머지는 흰색·회색. */
function pickupCard(p) {
  const today = kstDay();
  const line = o => {
    const [cls, note] = o.status === 'picked_up' ? ['is-done', `수령 완료 · ${time(pickedAt(o) ?? o.updatedAt)}`]
      : PENDING.includes(o.status) ? ['is-stop', '입금 미확인 · 전달 금지']
      : o.status === 'paid' ? (o.pickupDate !== today ? ['is-other', '수령일이 오늘이 아님'] : ['', ''])
      : ['is-done', `${ORDER_STATUS[o.status] ?? o.status} · 전달 안 함`];
    return `<li class="pk-line ${cls}"><code>${idHTML(o.id)}</code><span class="pk-date">${esc(pickupDateLabel(o.event, o.pickupDate))}${carried(o) ? ' · 1차' : ''}</span><span class="pk-qty">${o.quantity}개</span>${note ? `<span class="pk-note">${esc(note)}</span>` : ''}</li>`;
  };
  const qty = sumQty(p.give), last = p.done.at(-1);
  // 데스크톱 카드 가운데: 닉네임·수령일·총 개수. 전달할 게 없으면 이미 받은 것 또는 입금 미확인 기준으로 보여준다.
  const key = p.give.length ? p.give : p.done.length ? p.done : p.unpaid;
  const dates = [...new Set(key.map(o => pickupDateLabel(o.event, o.pickupDate)))].join(' · ') || '-';
  const notToday = p.give.some(o => o.pickupDate !== today);
  const [qtyCls, qtyNote] = p.give.length ? ['', '전달할 수량'] : p.done.length ? ['is-stop', '이미 수령함'] : p.unpaid.length ? ['is-stop', '입금 미확인 · 전달 금지'] : ['', '전달할 주문 없음'];
  return `<article class="pk-card">
    <header class="pk-head"><strong>${esc(p.nickname)}</strong><span>입금자명 ${esc(p.payers.join(' / '))}</span></header>
    <div class="pk-hero">
      <div class="pk-hero-fig"><span>수령일</span><strong>${esc(dates)}</strong><small class="${notToday ? 'is-other' : ''}">${notToday ? '오늘 수령분 아님' : '&nbsp;'}</small></div>
      <div class="pk-hero-fig"><span>총 개수</span><strong>${sumQty(key)}개</strong><small class="${qtyCls}">${esc(qtyNote)}</small></div>
    </div>
    <ul class="pk-lines">${p.orders.map(line).join('')}</ul>
    ${qty ? `<button class="primary pk-action" data-give="${p.userId}">${qty}개 전달 완료<kbd>Enter</kbd></button>`
      : last ? `<p class="pk-action is-stop">이미 수령함 · ${esc(time(pickedAt(last) ?? last.updatedAt))}</p>`
      : '<p class="pk-action">전달할 주문이 없어요</p>'}
  </article>`;
}
/**
 * 카드는 한 번에 한 사람만. 주문번호 끝 4자리·주문번호 전체·입금자명이 정확히 맞으면 그 사람만(운영 데이터에서 서로 겹치지 않음),
 * 아니면 부분 일치. 여러 명이면 왼쪽 후보에서 ↑↓나 클릭으로 골라야 오른쪽에 카드가 뜬다(자동으로 고르지 않음).
 */
let pickedUser = null, shownPeople = [];
const narrow = matchMedia('(max-width:900px)');
function matchPeople(q) {
  const exact = orders.filter(o => norm(o.id).slice(-4) === q || norm(o.id) === q || norm(o.payerName) === q);
  const hits = exact.length ? exact : orders.filter(o => [o.id, o.payerName, o.nickname].some(v => norm(v).includes(q)));
  return [...new Set(hits.map(o => o.userId))].map(personOf);
}
function candidate(p) {
  const [cls, label] = p.give.length ? ['', `${sumQty(p.give)}개 전달 가능`] : p.done.length ? ['is-stop', '이미 수령함'] : p.unpaid.length ? ['is-stop', '입금 미확인'] : ['', '전달할 주문 없음'];
  return `<li><button data-pick="${p.userId}" aria-selected="${p.userId === pickedUser}"><strong>${esc(p.nickname)}</strong><em class="${cls}">${esc(label)}</em><span>${esc(p.payers.join(' / '))}</span></button></li>`;
}
function renderPickup() {
  if (!$('#pk-stats')) return;
  renderPickupStats();
  const q = norm($('#pk-q').value), list = $('#pk-list'), card = $('#pk-results');
  const empty = text => `<p class="pk-empty">${text}</p>`;
  const people = q.length < 2 ? [] : matchPeople(q);
  const one = people.length === 1 ? people[0] : people.find(p => p.userId === pickedUser);
  shownPeople = people.length > 1 ? people.slice(0, 8) : [];
  $('#pickup').classList.toggle('picking', Boolean(one && people.length > 1));
  if (q.length < 2) list.innerHTML = '<p class="muted">주문번호 끝 4자리나 입금자명을 입력하세요.</p>';
  else if (!people.length) list.innerHTML = '<p class="muted">찾는 주문이 없어요. 주문번호를 다시 확인해주세요.</p>';
  else if (people.length === 1) list.innerHTML = '<p class="pk-count">1명 찾았어요.</p>';
  else list.innerHTML = `<p class="pk-count">${people.length}명이 찾아졌어요. 받을 사람을 고르세요.</p><ul class="pk-pick">${shownPeople.map(candidate).join('')}</ul>`
    + (people.length > shownPeople.length ? `<p class="muted">${people.length - shownPeople.length}명 더 있어요. 더 입력해서 좁혀주세요.</p>` : '');
  card.innerHTML = one ? (people.length > 1 ? `<button class="ghost pk-back" data-back>← 후보 ${people.length}명으로 돌아가기</button>` : '') + pickupCard(one)
    : empty(people.length > 1 ? '왼쪽에서 받을 사람을 고르세요' : '검색한 사람의 카드가 여기에 떠요');
}
function pick(userId) {
  pickedUser = userId;renderPickup();
  if (narrow.matches) ($('#pk-results .pk-card') ?? $('#pk-list')).scrollIntoView({block:'start'});
}
function showUndo(p, qty, orderIds) {
  clearInterval(undoTimer);
  let left = 10;
  const box = $('#pk-undo');
  box.innerHTML = `<span><strong>${esc(p.nickname)}</strong> ${qty}개 전달 완료 처리했어요.</span><button class="ghost" data-undo>되돌리기 <span>${left}</span></button>`;
  box.hidden = false;box.dataset.ids = JSON.stringify(orderIds);
  // 버튼을 다시 그리지 않고 숫자만 바꾼다(누르는 순간 버튼이 바뀌어 클릭이 사라지지 않도록).
  undoTimer = setInterval(() => {if (--left <= 0) {clearInterval(undoTimer);box.hidden = true;} else box.querySelector('[data-undo] span').textContent = left;}, 1000);
}
async function give(btn) {
  const p = personOf(Number(btn.dataset.give)), orderIds = p.give.map(o => o.id), qty = sumQty(p.give);
  await busy(btn, async () => {
    try {
      await api('POST', '/api/admin/pickup', {orderIds});
      showUndo(p, qty, orderIds);
      $('#pk-q').value = '';pickedUser = null;
    } catch (err) {
      toast(err.code === 'NETWORK' || err.code === 'TIMEOUT' ? `${err.message} 급하면 종이 명단에 체크해두세요.` : err.message);
    }
    await loadOrders().catch(() => {});
  });
  $('#pk-q').focus();
}
$('#pk-q').addEventListener('input', () => {pickedUser = null;renderPickup();});
// 노트북: 검색창에서 손을 떼지 않고 ↑↓로 고르고 Enter로 전달. 카드가 떠 있을 때만 Enter가 동작한다.
$('#pk-q').addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') {e.preventDefault();$('#pk-q').value = '';pickedUser = null;renderPickup();return;}
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shownPeople.length) {
    e.preventDefault();
    const i = shownPeople.findIndex(p => p.userId === pickedUser), n = shownPeople.length;
    pick(shownPeople[i < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].userId);
    return;
  }
  if (e.key === 'Enter') {e.preventDefault();const btn = $('#pk-results [data-give]');if (btn) give(btn);}
});
$('#pk-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-pick]');if (!btn) return;
  pick(Number(btn.dataset.pick));
  if (!narrow.matches) $('#pk-q').focus();
});
$('#pk-results').addEventListener('click', e => {
  if (e.target.closest('[data-back]')) {pick(null);return;}
  const btn = e.target.closest('[data-give]');if (btn) give(btn);
});
$('#pk-undo').addEventListener('click', async e => {
  const btn = e.target.closest('[data-undo]');if (!btn) return;
  clearInterval(undoTimer);
  await busy(btn, async () => {
    try {await api('POST', '/api/admin/pickup/undo', {orderIds:JSON.parse($('#pk-undo').dataset.ids)});$('#pk-undo').hidden = true;toast('되돌렸어요. 물건을 돌려받았는지 확인하세요.');}
    catch (err) {toast(err.message);}
    await loadOrders().catch(() => {});
  });
  $('#pk-q').focus();
});

// 인쇄용 명단: 그날 수령분을 수량 많은 순 → 닉네임 순으로, 체크 칸과 함께. 인터넷이 끊겼을 때 쓰는 종이 백업.
// 입금 미확인은 아래 따로 표(회색 바탕, 전달 금지). 수량이 바뀌는 줄에 두 줄 선을 그어 묶음을 나눈다.
/** 인쇄용 명단 날짜: 고른 행사의 수령일만. 오늘 이후 첫 날을 미리 고른다. */
function fillPrintDates() {
  const e = EVENTS[scope];
  $('#pk-print-date').innerHTML = e.dates.map(d => `<option value="${d.value}">${esc(e.name)} ${d.label}</option>`).join('');
  const today = kstDay(), opt = [...$('#pk-print-date').options].find(o => o.value >= today);
  if (opt) $('#pk-print-date').value = opt.value;
}
applyScope();fillPrintDates();
$('#pk-print').addEventListener('click', () => {
  const date = $('#pk-print-date').value;
  const ofDay = orders.filter(o => o.pickupDate === date);
  const rows = [...new Set(ofDay.map(o => o.userId))].flatMap(id => {
    const mine = ofDay.filter(o => o.userId === id);
    const who = {payer:[...new Set(mine.map(o => o.payerName))].join(' / '), nickname:mine.at(-1).nickname};
    const give = mine.filter(o => ['paid','picked_up'].includes(o.status)), unpaid = mine.filter(o => PENDING.includes(o.status));
    return [give.length && {...who, list:give, unpaid:false}, unpaid.length && {...who, list:unpaid, unpaid:true}].filter(Boolean);
  }).map(r => ({...r, qty:sumQty(r.list)}))
    .sort((a, b) => b.qty - a.qty || a.nickname.localeCompare(b.nickname, 'ko') || a.unpaid - b.unpaid);
  const table = list => `<table><thead><tr><th class="box">✔</th><th>닉네임</th><th>입금자명</th><th class="qty">수량</th><th class="note">비고</th></tr></thead><tbody>${list.map((r, i) => {
    const done = r.unpaid ? [] : r.list.filter(o => o.status === 'picked_up');
    const note = r.unpaid ? '전달 금지' : done.length ? `수령 ${time(pickedAt(done.at(-1)) ?? done.at(-1).updatedAt)}` : '';
    const cls = [r.unpaid && 'unpaid', i && list[i - 1].qty !== r.qty && 'qty-break'].filter(Boolean).join(' ');
    return `<tr class="${cls}"><td class="box">${!r.unpaid && done.length === r.list.length ? '✔' : ''}</td><td>${esc(r.nickname)}</td><td>${esc(r.payer)}</td><td class="qty">${r.qty}</td><td class="note">${esc([...r.list.map(o => carried(o) ? `${o.id}(1차)` : o.id), note].filter(Boolean).join(' / '))}</td></tr>`;
  }).join('')}</tbody></table>`;
  const paid = rows.filter(r => !r.unpaid), unpaid = rows.filter(r => r.unpaid);
  $('#print-sheet').innerHTML = `<h1>춤은 불법이 아니다 · ${esc($('#pk-print-date').selectedOptions[0].textContent)} 수령 명단</h1>
    <p>입금 확인 ${paid.length}명 · ${sumQty(paid.flatMap(r => r.list))}개 · 출력 ${esc(dayTime(new Date().toISOString()))} (이후 바뀐 내용은 화면이 기준)</p>
    ${table(paid)}
    ${unpaid.length ? `<h2>입금 미확인 · 전달 금지 (${unpaid.length}명 · ${sumQty(unpaid.flatMap(r => r.list))}개)</h2>${table(unpaid)}` : ''}`;
  window.print();
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

const TABS = {orders:loadOrders, pickup:() => loadOrders().then(() => $('#pk-q').focus()), threads:loadThreads, ledger:loadLedger};
function openTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  for (const id of Object.keys(TABS)) $(`#${id}`).hidden = tab !== id;
  history.replaceState(null, '', tab === 'orders' ? location.pathname : `#${tab}`);
  return TABS[tab]().catch(e => toast(e.message));
}
document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => openTab(t.dataset.tab)));
window.addEventListener('hashchange', () => {const tab = location.hash.slice(1);if (Object.hasOwn(TABS, tab) && $('#gate').hidden) openTab(tab);});

(async () => {
  const me = await api('GET', '/api/me').catch(() => ({user:null}));
  if (!me.user) {$('#gate').innerHTML = '운영자 계정으로 <a href="/api/auth/kakao/login?intent=admin">카카오 로그인</a>해주세요.';return;}
  if (!me.user.isAdmin) {$('#gate').innerHTML = '운영자로 등록된 계정이 아니에요. <a href="/">주문 페이지로 돌아가기</a>';return;}
  $('#gate').hidden = true;$('#who').textContent = `${me.user.nickname ?? ''} 님`;
  // /admin#pickup 으로 열면 바로 현장 수령 탭
  const first = location.hash.slice(1);
  await Promise.all([openTab(Object.hasOwn(TABS, first) ? first : 'orders'), loadThreads()]).catch(e => toast(e.message));
  // 열어 둔 동안 1분마다 갱신(입력 중인 메모를 지우지 않도록 주문 표는 포커스가 없을 때만)
  setInterval(() => {
    if (document.hidden) return;
    if (!$('#orders').hidden && !document.activeElement?.closest('#order-rows')) loadOrders().catch(() => {});
    loadThreads().catch(() => {});
  }, 60000);
  // 현장 수령 탭은 다른 폰에서 처리한 것도 보이도록 20초마다(누르는 중이면 건너뜀)
  setInterval(() => {
    if (!document.hidden && !$('#pickup').hidden && !document.querySelector('#pickup button:disabled')) loadOrders().catch(() => {});
  }, 20000);
})();
