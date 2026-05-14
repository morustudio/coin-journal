/*
  코인 매매일지 - script.js
  로컬스토리지 저장/로드, 차트/통계, 테이블, 모달,
  CSV 내보내기/가져오기, 구글 시트(Apps Script) 연동,
  다크/라이트 모드, 손익 자동계산, 모바일 대응
*/

/* ===== 스토리지 키 ===== */
const STORAGE_KEY    = 'cj:entries_v2';
const PRINCIPLES_KEY = 'cj:principles_v1';
const SETTINGS_KEY   = 'cj:settings_v2';
const THEME_KEY      = 'cj:theme_v1';
const SHEETS_URL_KEY = 'cj:sheets_url_v1';
const LAST_SYNC_KEY  = 'cj:last_sync_v1';

/* ===== 앱 상태 ===== */
let entries = [];
let settings = { startingCash: 10000 };
let currentId = null;
let currentRange = { type: 'ALL', from: null, to: null };
let sheetsUrl = '';
let syncState = 'disconnected'; // disconnected | synced | pending | error

/* ===== Apps Script 코드 (설정 모달에 표시) ===== */
const APPS_SCRIPT_CODE = `function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('매매일지')
    || ss.insertSheet('매매일지');

  var COLS = ['id','date','symbol','side','leverage',
    'avgEntry','exitPrice','quantity','fee','tp','sl',
    'realizedPnl','pnl','pnlPercent',
    'reason','exitReason','lesson','createdAt'];

  if (data.action === 'save') {
    sheet.clearContents();
    sheet.appendRow(COLS);
    data.entries.forEach(function(row) {
      sheet.appendRow(COLS.map(function(h){ return row[h] !== undefined ? String(row[h]) : ''; }));
    });
    return ContentService.createTextOutput(
      JSON.stringify({status:'ok', count: data.entries.length})
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (data.action === 'load') {
    var rows = sheet.getDataRange().getValues();
    if (rows.length < 2) return ContentService.createTextOutput(
      JSON.stringify({status:'ok', entries:[]})
    ).setMimeType(ContentService.MimeType.JSON);
    var colHeaders = rows[0];
    var entries = rows.slice(1).map(function(r) {
      var obj = {};
      colHeaders.forEach(function(h,i){ obj[h] = r[i] !== undefined ? String(r[i]) : ''; });
      return obj;
    });
    return ContentService.createTextOutput(
      JSON.stringify({status:'ok', entries: entries})
    ).setMimeType(ContentService.MimeType.JSON);
  }

  if (data.action === 'ping') {
    return ContentService.createTextOutput(
      JSON.stringify({status:'ok', message:'pong'})
    ).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(
    JSON.stringify({status:'error', message:'unknown action'})
  ).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({status:'ok', message:'코인 매매일지 연동 완료'})
  ).setMimeType(ContentService.MimeType.JSON);
}`

/* ===== DOM 참조 ===== */
const form           = document.getElementById('trade-form');
const tableBody      = document.getElementById('trade-table-body');
const emptyState     = document.getElementById('empty-state');

const principlesTA   = document.getElementById('principles');
const principlesSave = document.getElementById('principles-save-btn');
const principlesReset= document.getElementById('principles-reset-btn');
const principlesStat = document.getElementById('principles-status');

const startingCashEl = document.getElementById('startingCash');
const saveCashBtn    = document.getElementById('save-cash-btn');

const statEquity     = document.getElementById('stat-equity');
const statTotalPnl   = document.getElementById('stat-totalpnl');
const statCumRet     = document.getElementById('stat-cumret');
const statTodayPnl   = document.getElementById('stat-today-pnl');
const statTodayRet   = document.getElementById('stat-today-ret');

const chartCanvas    = document.getElementById('equityChart');
const ctx            = chartCanvas.getContext('2d');
const chartTooltip   = document.getElementById('chartTooltip');
const rangeToolbar   = document.getElementById('rangeToolbar');

const posOverallMain = document.getElementById('pos-overall-main');
const posOverallSub  = document.getElementById('pos-overall-sub');
const posLongMain    = document.getElementById('pos-long-main');
const posLongSub     = document.getElementById('pos-long-sub');
const posShortMain   = document.getElementById('pos-short-main');
const posShortSub    = document.getElementById('pos-short-sub');

// 입력폼 필드
const fDate       = () => document.getElementById('date');
const fSymbol     = () => document.getElementById('symbol');
const fSide       = () => document.getElementById('side');
const fLeverage   = () => document.getElementById('leverage');
const fAvgEntry   = () => document.getElementById('avgEntry');
const fQuantity   = () => document.getElementById('quantity');
const fFee        = () => document.getElementById('fee');
const fExitPrice  = () => document.getElementById('exitPrice');
const fTp         = () => document.getElementById('tp');
const fSl         = () => document.getElementById('sl');
const fPnl        = () => document.getElementById('pnl');
const fPnlPct     = () => document.getElementById('pnlPercent');
const fReason     = () => document.getElementById('reason');
const fExitReason = () => document.getElementById('exitReason');
const fLesson     = () => document.getElementById('lesson');

// 모달
const modalBackdrop = document.getElementById('modal-backdrop');
const modalBody     = document.getElementById('modal-body');
const m_date        = document.getElementById('m_date');
const m_symbol      = document.getElementById('m_symbol');
const m_side        = document.getElementById('m_side');
const m_leverage    = document.getElementById('m_leverage');
const m_avgEntry    = document.getElementById('m_avgEntry');
const m_exitPrice   = document.getElementById('m_exitPrice');
const m_qty         = document.getElementById('m_qty');
const m_fee         = document.getElementById('m_fee');
const m_tp          = document.getElementById('m_tp');
const m_sl          = document.getElementById('m_sl');
const m_realizedPnl = document.getElementById('m_realizedPnl');
const m_pnl         = document.getElementById('m_pnl');
const m_pnlp        = document.getElementById('m_pnlp');
const m_reason      = document.getElementById('m_reason');
const m_exit        = document.getElementById('m_exit');
const m_lesson      = document.getElementById('m_lesson');

// 시트 연동
const sheetsDot       = document.getElementById('sheets-dot');
const sheetsLabel     = document.getElementById('sheets-label');
const sheetsConnBtn   = document.getElementById('sheets-connect-btn');
const sheetsSyncBtn   = document.getElementById('sheets-sync-btn');
const sheetsLoadBtn   = document.getElementById('sheets-load-btn');
const sheetsSyncLabel = document.getElementById('sheets-sync-label');
const lastSyncLabel   = document.getElementById('last-sync-label');
const tableFooter     = document.getElementById('table-footer');

// 시트 설정 모달
const sheetsModalBackdrop = document.getElementById('sheets-modal-backdrop');
const sheetsModalClose    = document.getElementById('sheets-modal-close');
const sheetsUrlInput      = document.getElementById('sheets-url-input');
const sheetsSaveBtn       = document.getElementById('sheets-save-btn');
const sheetsDisconnBtn    = document.getElementById('sheets-disconnect-btn');
const sheetsTestResult    = document.getElementById('sheets-test-result');
const copyScriptBtn       = document.getElementById('copy-script-btn');
const appsScriptCodeEl    = document.getElementById('apps-script-code');

/* ===== 유틸 ===== */
const fmt2    = n => (n === '' || n === null || isNaN(Number(n))) ? '' : Number(n).toFixed(2);
const fmtNum  = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const todayISO= () => new Date().toISOString().slice(0, 10);
const toDate  = d  => new Date(d + 'T00:00:00');

function addMonths(date, m) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + m);
  d.setHours(0,0,0,0);
  return d;
}
function startOfMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}
function formatISO(d) {
  const z = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + z(d.getMonth()+1) + '-' + z(d.getDate());
}

/* ===== 테마 ===== */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefer = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  setTheme(saved || prefer);
}
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const moonIcon = document.querySelector('.icon-moon');
  const sunIcon  = document.querySelector('.icon-sun');
  if (theme === 'dark') {
    moonIcon.style.display = '';
    sunIcon.style.display  = 'none';
  } else {
    moonIcon.style.display = 'none';
    sunIcon.style.display  = '';
  }
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  const curr = document.documentElement.getAttribute('data-theme');
  setTheme(curr === 'dark' ? 'light' : 'dark');
  renderStatsAndChart(); // 차트 색상 갱신
});

/* ===== 날짜 picker 자동오픈 ===== */
function hookDatePickers() {
  document.querySelectorAll('input[type="date"]').forEach(el => {
    if (el.__hooked) return;
    el.__hooked = true;
    el.addEventListener('click', () => { try { el.showPicker(); } catch(e){} });
  });
}

/* ===== 원칙 ===== */
function loadPrinciples() {
  const stored = localStorage.getItem(PRINCIPLES_KEY);
  if (stored !== null) {
    principlesTA.value = stored;
    principlesStat.textContent = stored.trim() ? '마지막 저장된 매매 원칙을 불러왔습니다.' : '저장된 내용이 비어 있습니다.';
  }
}
function savePrinciples() {
  localStorage.setItem(PRINCIPLES_KEY, (principlesTA.value || '').trim());
  principlesStat.textContent = `저장됨: ${new Date().toLocaleString('ko-KR')}`;
}
principlesSave.addEventListener('click', savePrinciples);
principlesTA.addEventListener('blur', () => {
  if ((principlesTA.value||'').trim() !== (localStorage.getItem(PRINCIPLES_KEY)||'')) savePrinciples();
});
principlesReset.addEventListener('click', () => {
  if (!confirm('매매 원칙을 모두 비울까요?')) return;
  principlesTA.value = '';
  localStorage.removeItem(PRINCIPLES_KEY);
  principlesStat.textContent = '매매 원칙이 삭제되었습니다.';
});

/* ===== 설정 ===== */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.startingCash === 'number' && p.startingCash >= 0) {
        settings.startingCash = p.startingCash;
      }
    }
  } catch(e) {}
  startingCashEl.value = settings.startingCash;
}
function saveSettings() {
  const val = parseFloat(startingCashEl.value);
  if (isNaN(val) || val < 0) { alert('증거금은 0 이상 숫자여야 합니다.'); return; }
  settings.startingCash = val;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ startingCash: val }));
  renderAll();
}
saveCashBtn.addEventListener('click', saveSettings);

/* ===== 기록 저장/로드 ===== */
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) entries = [];
  } catch(e) { entries = []; }
}
function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  markPending();
}

/* ===== 손익 자동계산 ===== */
/*
  실현손익  = (진입가 - 청산가) × 수량        ← SHORT
            = (청산가 - 진입가) × 수량        ← LONG
            레버리지 미포함 (바이낸스 Realized PNL 방식)

  최종손익  = 실현손익 - 수수료

  손익률    = 최종손익 / 증거금 × 100
  증거금    = 진입가 × 수량 / 레버리지
*/
function calcPnl(side, entry, exit, qty, leverage, fee) {
  const e  = parseFloat(entry);
  const ex = parseFloat(exit);
  const q  = parseFloat(qty);
  const lv = parseFloat(leverage) || 1;
  const f  = parseFloat(fee) || 0;
  if (isNaN(e) || isNaN(ex) || isNaN(q) || !e || !q) return null;

  // 실현손익 (레버리지 미포함 — 바이낸스 Realized PNL과 동일)
  const priceDiff   = side === 'SHORT' ? (e - ex) : (ex - e);
  const realizedPnl = priceDiff * q;

  // 최종손익 = 실현손익 - 수수료
  const finalPnl = realizedPnl - f;

  // 손익률 = 최종손익 / 증거금 × 100  (증거금 기준)
  const margin   = (e * q) / lv;
  const pnlPct   = margin > 0 ? (finalPnl / margin) * 100 : 0;

  return {
    realizedPnl: realizedPnl.toFixed(6),
    pnl:         finalPnl.toFixed(2),
    pnlPercent:  pnlPct.toFixed(2),
  };
}

function autoCalcPnl() {
  const side      = fSide().value;
  const entry     = fAvgEntry().value;
  const exit      = fExitPrice().value;
  const qty       = fQuantity().value;
  const leverage  = fLeverage().value || '1';
  const fee       = fFee().value || '0';
  const breakdown = document.getElementById('pnl-breakdown');

  // 청산가 있으면 실현손익 자동계산
  if (exit && entry && qty) {
    const r = calcPnl(side, entry, exit, qty, leverage, fee);
    if (r) {
      document.getElementById('realizedPnl').value = r.realizedPnl;
      fPnl().value    = r.pnl;
      fPnlPct().value = r.pnlPercent;
      updateBreakdown(breakdown, r.realizedPnl, fee, r.pnl, r.pnlPercent);
      return;
    }
  }

  // 실현손익 직접 입력 시 최종손익 계산
  const realizedVal = document.getElementById('realizedPnl').value;
  if (realizedVal && realizedVal !== '') {
    const realized = parseFloat(realizedVal);
    const f        = parseFloat(fee) || 0;
    const lv       = parseFloat(leverage) || 1;
    const e        = parseFloat(entry) || 0;
    const q        = parseFloat(qty) || 0;
    const finalPnl = realized - f;
    const margin   = e && q && lv ? (e * q) / lv : 0;
    const pct      = margin > 0 ? (finalPnl / margin * 100).toFixed(2) : '';
    fPnl().value    = finalPnl.toFixed(2);
    fPnlPct().value = pct;
    updateBreakdown(breakdown, realizedVal, fee, finalPnl.toFixed(2), pct);
  }
}

function updateBreakdown(el, realized, fee, finalPnl, pct) {
  if (!el) return;
  const r  = parseFloat(realized) || 0;
  const f  = parseFloat(fee)      || 0;
  const p  = parseFloat(finalPnl) || 0;
  const rClass  = r >= 0 ? 'pnl-positive' : 'pnl-negative';
  const pClass  = p >= 0 ? 'pnl-positive' : 'pnl-negative';
  const sign    = n => n >= 0 ? '+' : '';
  el.innerHTML = `
    <span class="pnl-breakdown-item">
      <span class="pnl-breakdown-label">실현손익</span>
      <span class="pnl-breakdown-value ${rClass}">${sign(r)}${r.toFixed(2)} USDT</span>
    </span>
    <span class="pnl-breakdown-divider">−</span>
    <span class="pnl-breakdown-item">
      <span class="pnl-breakdown-label">수수료</span>
      <span class="pnl-breakdown-value" style="color:var(--pnl-neg)">-${f.toFixed(2)} USDT</span>
    </span>
    <span class="pnl-breakdown-divider">=</span>
    <span class="pnl-breakdown-item">
      <span class="pnl-breakdown-label">최종손익</span>
      <span class="pnl-breakdown-value ${pClass}">${sign(p)}${p.toFixed(2)} USDT${pct ? ` (${sign(parseFloat(pct))}${pct}%)` : ''}</span>
    </span>
  `;
}

// 관련 필드 변경 시 자동계산
['exitPrice','realizedPnl','avgEntry','quantity','leverage','fee','side'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', autoCalcPnl);
});

// 손익 미리보기 버튼 (TP/SL 기준)
document.getElementById('calc-preview-btn').addEventListener('click', () => {
  const side  = fSide().value;
  const entry = fAvgEntry().value;
  const qty   = fQuantity().value;
  const lv    = fLeverage().value || '1';
  const fee   = fFee().value || '0';

  if (!entry || !qty) { showToast('진입가와 수량을 먼저 입력해주세요.', 2000); return; }

  const tp = fTp().value;
  const sl = fSl().value;
  let html = `<div style="font-weight:700;margin-bottom:8px;">💰 TP/SL 손익 미리보기</div>`;

  if (tp) {
    const r = calcPnl(side, entry, tp, qty, lv, fee);
    if (r) html += `
      <div>🎯 TP 도달: <b style="color:var(--pnl-pos)">+${r.pnl} USDT (+${r.pnlPercent}%)</b></div>
      <div style="color:var(--text-muted);font-size:11px;margin-bottom:4px;">실현 ${(+r.realizedPnl).toFixed(2)} / 수수료 -${(+fee).toFixed(2)}</div>`;
  }
  if (sl) {
    const r = calcPnl(side, entry, sl, qty, lv, fee);
    if (r) html += `
      <div>🛑 SL 도달: <b style="color:var(--pnl-neg)">${r.pnl} USDT (${r.pnlPercent}%)</b></div>
      <div style="color:var(--text-muted);font-size:11px;">실현 ${(+r.realizedPnl).toFixed(2)} / 수수료 -${(+fee).toFixed(2)}</div>`;
  }
  if (!tp && !sl) html += `<div style="color:var(--text-muted)">목표가(TP) 또는 손절가(SL)를 입력해주세요.</div>`;
  showToast(html, 5000);
});

function showToast(html, duration = 3000) {
  const toast = document.getElementById('calc-toast');
  toast.innerHTML = html;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

/* ===== 기간 필터 ===== */
function setRangePreset(type) {
  const now = new Date();
  let from = null;
  if      (type === 'WEEK') from = startOfMonday(now);
  else if (type === '1M')   from = addMonths(now, -1);
  else if (type === '3M')   from = addMonths(now, -3);
  else if (type === '6M')   from = addMonths(now, -6);
  else if (type === '1Y')   from = addMonths(now, -12);
  currentRange = { type, from, to: now };
  document.querySelectorAll('[data-range]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === type);
  });
  renderAll();
}
rangeToolbar.addEventListener('click', e => {
  const btn = e.target.closest('[data-range]');
  if (btn) setRangePreset(btn.dataset.range);
});

/* ===== 필터된 항목 ===== */
function entriesInWindow() {
  const from = currentRange.from;
  const to   = currentRange.to || new Date();
  return entries.filter(e => {
    const d = e.date ? toDate(e.date) : new Date(e.createdAt || Date.now());
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

/* ===== 테이블 렌더 ===== */
function renderTable() {
  const rows = entriesInWindow().slice().sort((a,b) => b.createdAt - a.createdAt);
  tableBody.innerHTML = '';
  emptyState.style.display = rows.length ? 'none' : 'block';
  rows.forEach(entry => {
    const tr = document.createElement('tr');
    tr.dataset.id = entry.id;
    const pnlNum   = parseFloat(entry.pnl || 0);
    const realNum  = parseFloat(entry.realizedPnl || 0);
    const feeNum   = parseFloat(entry.fee || 0);
    const pnlClass = pnlNum > 0 ? 'pnl-positive' : pnlNum < 0 ? 'pnl-negative' : 'pnl-zero';
    const sideTag  = entry.side === 'SHORT'
      ? '<span class="tag-short">SHORT</span>'
      : '<span class="tag-long">LONG</span>';
    const lv = entry.leverage ? `${entry.leverage}x` : '-';
    const sign = n => n >= 0 ? '+' : '';

    // 손익 표시: 최종손익 + 분해 (실현/수수료)
    const pnlDisplay = entry.pnl
      ? `<span class="${pnlClass}">${sign(pnlNum)}${fmt2(entry.pnl)}</span>
         ${(entry.realizedPnl || entry.fee) ? `<div class="pnl-sub">${entry.realizedPnl ? `실현 ${sign(realNum)}${fmt2(entry.realizedPnl)}` : ''}${entry.fee ? ` / 수수료 -${fmt2(entry.fee)}` : ''}</div>` : ''}`
      : '-';

    tr.innerHTML = `
      <td>${entry.date || ''}</td>
      <td><b>${entry.symbol || ''}</b></td>
      <td>${sideTag}</td>
      <td class="text-mono">${lv}</td>
      <td class="text-mono">${fmt2(entry.avgEntry)}</td>
      <td class="text-mono">${entry.exitPrice ? fmt2(entry.exitPrice) : '-'}</td>
      <td class="text-mono">${fmt2(entry.quantity)}</td>
      <td>${pnlDisplay}</td>
      <td class="${pnlClass}">${entry.pnlPercent ? sign(parseFloat(entry.pnlPercent)) + fmt2(entry.pnlPercent) + '%' : '-'}</td>
    `;
    tableBody.appendChild(tr);
  });
}

/* ===== 차트 & 통계 ===== */
let lastChartGeom = null;
function computeEquitySeries() {
  const startCash = Number(settings.startingCash) || 0;
  const from = currentRange.from;
  const now  = currentRange.to || new Date();

  const pnlBefore = entries.reduce((acc, e) => {
    const d = e.date ? toDate(e.date) : new Date(e.createdAt || Date.now());
    if (from && d < from) acc += Number(e.pnl) || 0;
    return acc;
  }, 0);
  const baselineEquity = startCash + pnlBefore;

  const rows = entries.filter(e => {
    const d = e.date ? toDate(e.date) : new Date(e.createdAt || Date.now());
    return !(from && d < from) && d <= now;
  }).slice().sort((a,b) => {
    const da = a.date ? toDate(a.date) : new Date(a.createdAt||0);
    const db = b.date ? toDate(b.date) : new Date(b.createdAt||0);
    return da - db;
  });

  let cum = 0;
  const points = [];
  const firstLabel = from ? formatISO(from) : (rows[0]?.date || 'Start');
  points.push({ label: firstLabel, equity: baselineEquity, pnl: 0 });
  rows.forEach(e => {
    const pnl = Number(e.pnl) || 0;
    cum += pnl;
    points.push({ label: e.date || formatISO(new Date(e.createdAt||Date.now())), equity: baselineEquity + cum, pnl: cum });
  });
  if (points.length === 1) points.push({ label: formatISO(now), equity: baselineEquity, pnl: 0 });

  return { baselineEquity, lastEquity: baselineEquity + cum, totalPnl: cum, points };
}

function renderStatsAndChart() {
  const { baselineEquity, lastEquity, totalPnl, points } = computeEquitySeries();
  const cumRet = baselineEquity > 0 ? ((lastEquity - baselineEquity) / baselineEquity * 100) : 0;
  const pnlClass = totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative';

  statEquity.textContent   = fmtNum(lastEquity);
  statTotalPnl.className   = 'value ' + pnlClass;
  statTotalPnl.textContent = (totalPnl >= 0 ? '+' : '') + fmtNum(totalPnl);
  statCumRet.className     = 'value ' + pnlClass;
  statCumRet.textContent   = (cumRet >= 0 ? '+' : '') + cumRet.toFixed(2) + '%';

  renderTodayStats();
  drawChart(points, baselineEquity);
}

function renderTodayStats() {
  const startCash = Number(settings.startingCash) || 0;
  const today = todayISO();
  const dailyPnl = {};
  entries.forEach(e => {
    if (!e.date) return;
    dailyPnl[e.date] = (dailyPnl[e.date] || 0) + (Number(e.pnl) || 0);
  });
  const dates = Object.keys(dailyPnl).sort();
  let cum = 0;
  const equityByDate = {};
  dates.forEach(d => { cum += dailyPnl[d]; equityByDate[d] = startCash + cum; });

  const todayPnlVal = dailyPnl[today] || 0;
  statTodayPnl.className   = 'value ' + (todayPnlVal >= 0 ? 'pnl-positive' : 'pnl-negative');
  statTodayPnl.textContent = (todayPnlVal >= 0 ? '+' : '') + fmtNum(todayPnlVal);

  let prevEquity = startCash;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] < today) { prevEquity = equityByDate[dates[i]]; break; }
  }
  const retOnCash  = startCash  > 0 ? (todayPnlVal / startCash  * 100).toFixed(2) + '%' : '-';
  const retVsPrev  = prevEquity > 0 ? (todayPnlVal / prevEquity * 100).toFixed(2) + '%' : '-';
  statTodayRet.textContent = `예수금 기준: ${retOnCash} / 전일 대비: ${retVsPrev}`;
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    line:     isDark ? 'rgba(59,130,246,0.9)'  : 'rgba(37,99,235,0.9)',
    linePos:  isDark ? 'rgba(52,211,153,0.9)'  : 'rgba(22,163,74,0.9)',
    lineNeg:  isDark ? 'rgba(248,113,113,0.9)' : 'rgba(220,38,38,0.9)',
    baseline: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(100,116,139,0.3)',
    label:    isDark ? '#64748b'               : '#9ca3af',
    grid:     isDark ? 'rgba(255,255,255,0.04)': 'rgba(0,0,0,0.04)',
  };
}

function drawChart(points, baseline) {
  const dpr = window.devicePixelRatio || 1;
  const rect = chartCanvas.parentElement.getBoundingClientRect();
  const cssW = rect.width || 600;
  const cssH = 220;
  chartCanvas.width  = cssW * dpr;
  chartCanvas.height = cssH * dpr;
  chartCanvas.style.width  = cssW + 'px';
  chartCanvas.style.height = cssH + 'px';
  ctx.scale(dpr, dpr);

  const w = cssW, h = cssH;
  const padL = 56, padR = 14, padT = 12, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const colors = getChartColors();

  ctx.clearRect(0, 0, w, h);

  const values = points.map(p => p.equity);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const span = maxV - minV || 1;

  const toX = i   => padL + (i / Math.max(points.length - 1, 1)) * innerW;
  const toY = val => h - padB - ((val - minV) / span) * innerH;

  // 격자선
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(t => {
    const y = padT + t * innerH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });

  // 기준선
  const yBase = toY(baseline);
  ctx.strokeStyle = colors.baseline;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(padL, yBase); ctx.lineTo(w - padR, yBase); ctx.stroke();
  ctx.setLineDash([]);

  // 영역 채우기
  const lastEquity = points[points.length - 1]?.equity || baseline;
  const isProfit = lastEquity >= baseline;
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  if (isProfit) {
    grad.addColorStop(0, 'rgba(52,211,153,0.18)');
    grad.addColorStop(1, 'rgba(52,211,153,0)');
  } else {
    grad.addColorStop(0, 'rgba(248,113,113,0)');
    grad.addColorStop(1, 'rgba(248,113,113,0.18)');
  }
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = toX(i), y = toY(p.equity);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(points.length - 1), h - padB);
  ctx.lineTo(toX(0), h - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 라인
  ctx.strokeStyle = isProfit ? colors.linePos : colors.lineNeg;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = toX(i), y = toY(p.equity);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Y 레이블
  ctx.fillStyle = colors.label;
  ctx.font = `10px var(--font-mono, monospace)`;
  ctx.textAlign = 'right';
  [maxV, baseline, minV].forEach(v => {
    const y = toY(v);
    ctx.fillText(fmtNum(v), padL - 4, y + 3);
  });

  // X 레이블 (첫 / 마지막)
  ctx.textAlign = 'left';
  if (points.length >= 2) {
    ctx.fillText(points[0].label, padL, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText(points[points.length-1].label, w - padR, h - 6);
  }

  lastChartGeom = { padL, padR, padT, padB, innerW, innerH, minV, span, w, h, points, dpr };
}

// 차트 툴팁
chartCanvas.addEventListener('mousemove', e => {
  if (!lastChartGeom) return;
  const rect = chartCanvas.getBoundingClientRect();
  const { padL, innerW, points, minV, span, h, padB, innerH, dpr } = lastChartGeom;
  const x = e.clientX - rect.left;
  let t = (x - padL) / innerW;
  t = Math.max(0, Math.min(1, t));
  const idx = Math.round(t * (points.length - 1));
  const p = points[idx];
  const px = padL + (idx / Math.max(points.length-1,1)) * innerW;
  const py = h - padB - ((p.equity - minV) / span) * innerH;
  const base = points[0]?.equity || 0;
  const ret  = base > 0 ? ((p.equity - base) / base * 100) : 0;
  const pnl  = p.equity - base;

  chartTooltip.style.display = 'block';
  chartTooltip.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">${p.label}</div>
    <div>평가금: <b>${fmtNum(p.equity)}</b></div>
    <div>누적 손익: <b style="color:${pnl>=0?'var(--pnl-pos)':'var(--pnl-neg)'}">${pnl>=0?'+':''}${fmtNum(pnl)}</b></div>
    <div>누적 수익률: <b style="color:${ret>=0?'var(--pnl-pos)':'var(--pnl-neg)'}">${ret>=0?'+':''}${ret.toFixed(2)}%</b></div>
  `;

  const tooltipW = chartTooltip.offsetWidth || 160;
  const centerX  = rect.width / 2;
  let tooltipX   = x > centerX ? px - tooltipW - 12 : px + 12;
  tooltipX = Math.max(0, Math.min(tooltipX, rect.width - tooltipW));
  chartTooltip.style.left = tooltipX + 'px';
  chartTooltip.style.top  = Math.max(0, py - 12) + 'px';
});
chartCanvas.addEventListener('mouseleave', () => { chartTooltip.style.display = 'none'; });

/* ===== 포지션 통계 ===== */
function renderPositionStats() {
  const s = { total:{win:0,lose:0}, long:{win:0,lose:0}, short:{win:0,lose:0} };
  entries.forEach(e => {
    const pnl = Number(e.pnl);
    if (!isFinite(pnl) || pnl === 0) return;
    const isShort = (e.side||'LONG').toUpperCase() === 'SHORT';
    const key = isShort ? 'short' : 'long';
    pnl > 0 ? (s[key].win++, s.total.win++) : (s[key].lose++, s.total.lose++);
  });
  const pct = (w,t) => t ? (w/t*100).toFixed(1)+'%' : '-';
  const fmt = (g,n) => `WIN ${g.win} / LOSE ${g.lose}`;

  posOverallMain.textContent = fmt(s.total);
  posOverallSub.textContent  = `승률 ${pct(s.total.win, s.total.win+s.total.lose)} (총 ${s.total.win+s.total.lose})`;
  posLongMain.textContent    = fmt(s.long);
  posLongSub.textContent     = `승률 ${pct(s.long.win, s.long.win+s.long.lose)} (총 ${s.long.win+s.long.lose})`;
  posShortMain.textContent   = fmt(s.short);
  posShortSub.textContent    = `승률 ${pct(s.short.win, s.short.win+s.short.lose)} (총 ${s.short.win+s.short.lose})`;
}

function renderAll() {
  renderTable();
  renderStatsAndChart();
  renderPositionStats();
}

/* ===== 폼 제출 ===== */
form.addEventListener('submit', e => {
  e.preventDefault();
  const date        = fDate().value || todayISO();
  const symbol      = fSymbol().value;
  const side        = fSide().value;
  const leverage    = fLeverage().value || '1';
  const avgEntry    = fAvgEntry().value;
  const quantity    = fQuantity().value;
  const fee         = fFee().value;
  const exitPrice   = fExitPrice().value;
  const tp          = fTp().value;
  const sl          = fSl().value;
  const reason      = fReason().value.trim();
  const exitReason  = fExitReason().value.trim();
  const lesson      = fLesson().value.trim();

  if (!date || !symbol || !avgEntry || !quantity) {
    alert('날짜, 종목, 진입가, 수량은 필수입니다.');
    return;
  }

  // 청산가 있으면 자동계산, 없으면 입력값 사용
  let realizedPnl = document.getElementById('realizedPnl').value;
  let pnl         = fPnl().value;
  let pnlPercent  = fPnlPct().value;

  if (exitPrice) {
    const r = calcPnl(side, avgEntry, exitPrice, quantity, leverage, fee);
    if (r) { realizedPnl = r.realizedPnl; pnl = r.pnl; pnlPercent = r.pnlPercent; }
  } else if (realizedPnl) {
    // 실현손익 직접 입력 시 최종손익 계산
    const realized = parseFloat(realizedPnl);
    const f        = parseFloat(fee) || 0;
    const lv       = parseFloat(leverage) || 1;
    const ep       = parseFloat(avgEntry) || 0;
    const q        = parseFloat(quantity) || 0;
    const finalPnl = realized - f;
    const margin   = ep && q && lv ? (ep * q) / lv : 0;
    pnl            = finalPnl.toFixed(2);
    pnlPercent     = margin > 0 ? (finalPnl / margin * 100).toFixed(2) : '';
  }

  entries.push({
    id: Date.now(), createdAt: Date.now(),
    date, symbol, side, leverage, avgEntry, exitPrice,
    quantity, fee, tp, sl,
    realizedPnl, pnl, pnlPercent,
    reason, exitReason, lesson
  });

  saveEntries();
  renderAll();
  resetForm();
});

function resetForm() {
  form.reset();
  fDate().value     = todayISO();
  fLeverage().value = '1';
  const breakdown = document.getElementById('pnl-breakdown');
  if (breakdown) breakdown.innerHTML = '';
}
document.getElementById('reset-form-btn').addEventListener('click', resetForm);
document.getElementById('clear-all-btn').addEventListener('click', () => {
  if (!confirm('모든 매매 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
  entries = [];
  saveEntries();
  renderAll();
});

/* ===== 모달 ===== */
tableBody.addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (tr) openModal(Number(tr.dataset.id));
});

function openModal(id) {
  currentId = id;
  const row = entries.find(r => r.id === id);
  if (!row) return;

  m_date.value      = row.date || '';
  m_symbol.value    = row.symbol || 'BTC';
  m_side.value      = row.side || 'LONG';
  m_leverage.value  = row.leverage || '1';
  m_avgEntry.value  = row.avgEntry || '';
  m_exitPrice.value = row.exitPrice || '';
  m_qty.value       = row.quantity || '';
  m_fee.value         = row.fee || '';
  m_tp.value          = row.tp || '';
  m_sl.value          = row.sl || '';
  m_realizedPnl.value = row.realizedPnl || '';
  m_pnl.value         = row.pnl || '';
  m_pnlp.value        = row.pnlPercent || '';

  // 손익 분해 표시
  const bd = document.getElementById('m_pnl_breakdown');
  if (bd) updateBreakdown(bd, row.realizedPnl, row.fee, row.pnl, row.pnlPercent);
  m_reason.value    = row.reason || '';
  m_exit.value      = row.exitReason || '';
  m_lesson.value    = row.lesson || '';

  setModalReadOnly(true);
  modalBackdrop.style.display = 'flex';
  document.body.classList.add('modal-open');
  hookDatePickers();
}

function closeModal() {
  modalBackdrop.style.display = 'none';
  document.body.classList.remove('modal-open');
  currentId = null;
}

function setModalReadOnly(ro) {
  [m_date, m_symbol, m_side, m_leverage, m_avgEntry, m_exitPrice,
   m_qty, m_fee, m_tp, m_sl, m_realizedPnl, m_pnl, m_pnlp, m_reason, m_exit, m_lesson
  ].forEach(el => { el.disabled = ro; });
  modalBody.classList.toggle('readonly', ro);
  document.getElementById('modal-edit').style.display   = ro ? '' : 'none';
  document.getElementById('modal-save').style.display   = ro ? 'none' : '';
  document.getElementById('modal-cancel').style.display = ro ? 'none' : '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalBackdrop.style.display === 'flex') closeModal(); });

document.getElementById('modal-edit').addEventListener('click', () => setModalReadOnly(false));
document.getElementById('modal-cancel').addEventListener('click', () => { if (currentId !== null) openModal(currentId); });

document.getElementById('modal-save').addEventListener('click', () => {
  if (currentId === null) return;
  if (!m_date.value || !m_avgEntry.value || !m_qty.value) {
    alert('날짜, 진입가, 수량은 필수입니다.');
    return;
  }
  entries = entries.map(row => {
    if (row.id !== currentId) return row;
    // 모달에서 청산가 수정 시 손익 재계산
    let pnl  = m_pnl.value;
    let pnlp = m_pnlp.value;
    let realizedPnl = m_realizedPnl.value;
    if (m_exitPrice.value) {
      const r = calcPnl(m_side.value, m_avgEntry.value, m_exitPrice.value, m_qty.value, m_leverage.value, m_fee.value);
      if (r) { realizedPnl = r.realizedPnl; pnl = r.pnl; pnlp = r.pnlPercent; }
    } else if (realizedPnl) {
      const realized = parseFloat(realizedPnl);
      const f  = parseFloat(m_fee.value) || 0;
      const lv = parseFloat(m_leverage.value) || 1;
      const ep = parseFloat(m_avgEntry.value) || 0;
      const q  = parseFloat(m_qty.value) || 0;
      const finalPnl = realized - f;
      const margin   = ep && q && lv ? (ep * q) / lv : 0;
      pnl  = finalPnl.toFixed(2);
      pnlp = margin > 0 ? (finalPnl / margin * 100).toFixed(2) : '';
    }
    return {
      ...row,
      date: m_date.value, symbol: m_symbol.value, side: m_side.value,
      leverage: m_leverage.value, avgEntry: m_avgEntry.value,
      exitPrice: m_exitPrice.value, quantity: m_qty.value,
      fee: m_fee.value, tp: m_tp.value, sl: m_sl.value,
      realizedPnl,
      pnl, pnlPercent: pnlp,
      reason: m_reason.value.trim(), exitReason: m_exit.value.trim(), lesson: m_lesson.value.trim()
    };
  });
  saveEntries();
  renderAll();
  setModalReadOnly(true);
});

document.getElementById('modal-delete').addEventListener('click', () => {
  if (currentId === null) return;
  if (!confirm('이 매매 기록을 삭제할까요?')) return;
  entries = entries.filter(r => r.id !== currentId);
  saveEntries();
  renderAll();
  closeModal();
});

/* ===== CSV ===== */
const CSV_HEADERS = ['id','createdAt','date','symbol','side','leverage',
  'avgEntry','exitPrice','quantity','fee','tp','sl',
  'realizedPnl','pnl','pnlPercent',
  'reason','exitReason','lesson'];

document.getElementById('export-csv-btn').addEventListener('click', () => {
  const lines = [CSV_HEADERS.join(',')];
  entries.forEach(e => {
    lines.push(CSV_HEADERS.map(k => `"${String(e[k]??'').replace(/"/g,'""')}"`).join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `coin_journal_${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('import-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-file').click();
});
document.getElementById('csv-file').addEventListener('change', ev => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text   = String(e.target.result || '');
      const parsed = parseCSV(text);
      const rows   = normalizeRows(parsed);
      if (!rows.length) { alert('가져올 유효한 행이 없습니다.'); return; }
      const merge = confirm(`${rows.length}건 발견.\n[확인]=기존에 추가  [취소]=전체 교체`);
      entries = merge ? entries.concat(rows) : rows;
      saveEntries();
      renderAll();
      alert(`가져오기 완료: ${rows.length}건`);
    } catch(err) {
      console.error(err);
      alert('CSV 파싱 오류. 파일 형식을 확인해 주세요.');
    } finally { ev.target.value = ''; }
  };
  reader.readAsText(file, 'utf-8');
});

function parseCSV(text) {
  const rows = []; let i = 0, cell = '', inQ = false, row = [];
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow  = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) { if (ch==='"') { if (text[i+1]==='"') { cell+='"'; i++; } else inQ=false; } else cell+=ch; }
    else {
      if (ch==='"') inQ=true;
      else if (ch===',') pushCell();
      else if (ch==='\r') {}
      else if (ch==='\n') { pushCell(); pushRow(); }
      else cell+=ch;
    }
    i++;
  }
  if (cell.length || row.length) { pushCell(); pushRow(); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c=>c.trim())).map(r => {
    const o = {}; header.forEach((h,idx) => { o[h] = r[idx] ?? ''; }); return o;
  });
}

function normalizeRows(items) {
  const g = (o, keys) => { const k = keys.find(k => k in o); return k ? o[k] : ''; };
  return items.map((o, idx) => {
    const date     = g(o, ['date','날짜']);
    const avgEntry = g(o, ['avgEntry','진입가','평균진입가']);
    const quantity = g(o, ['quantity','수량']);
    if (!date || !avgEntry || !quantity) return null;
    let id = g(o, ['id']); let createdAt = g(o, ['createdAt']);
    if (!id) id = Date.now() + idx;
    if (!createdAt) createdAt = Date.parse(date) || Date.now() + idx;
    return {
      id: Number(id), createdAt: Number(createdAt),
      date: String(date), symbol: String(g(o,['symbol','종목'])||'BTC'),
      side: String(g(o,['side','포지션'])||'LONG'),
      leverage: String(g(o,['leverage','레버리지'])||'1'),
      avgEntry: String(avgEntry), exitPrice: String(g(o,['exitPrice','청산가'])||''),
      quantity: String(quantity), fee: String(g(o,['fee','수수료'])||''),
      tp: String(g(o,['tp','목표가'])||''), sl: String(g(o,['sl','손절가'])||''),
      pnl: String(g(o,['pnl','손익'])||''), pnlPercent: String(g(o,['pnlPercent','손익률'])||''),
      reason: String(g(o,['reason','진입근거'])||''),
      exitReason: String(g(o,['exitReason','청산이유'])||''),
      lesson: String(g(o,['lesson','교훈','피드백'])||''),
    };
  }).filter(Boolean).sort((a,b) => a.createdAt - b.createdAt);
}

/* ===== 구글 시트 (Apps Script) 연동 ===== */
function loadSheetsUrl() {
  sheetsUrl = localStorage.getItem(SHEETS_URL_KEY) || '';
  if (sheetsUrl) {
    setSyncState('synced');
    sheetsLoadBtn.disabled = false;
  } else {
    setSyncState('disconnected');
    sheetsLoadBtn.disabled = true;
  }
  updateLastSyncLabel();
}

function setSyncState(state) {
  syncState = state;
  sheetsDot.className = 'sheets-dot ' + (state === 'disconnected' ? '' : state);
  sheetsSyncBtn.className = `btn btn-sheets-sync btn-sm ${state === 'synced' ? 'synced' : state === 'pending' ? 'pending' : state === 'error' ? 'error' : ''}`;

  const labels = {
    disconnected: '시트 미연결',
    synced:  '✓ 동기화 완료',
    pending: '● 미동기화',
    error:   '✕ 오류',
    loading: '동기화 중...'
  };
  sheetsLabel.textContent    = labels[state] || state;
  sheetsSyncLabel.textContent= state === 'loading' ? '동기화 중...' : state === 'synced' ? '동기화 완료' : '시트 동기화';
}

function markPending() {
  if (sheetsUrl && syncState !== 'disconnected') setSyncState('pending');
}

function updateLastSyncLabel() {
  const last = localStorage.getItem(LAST_SYNC_KEY);
  if (last && sheetsUrl) {
    const d = new Date(Number(last));
    lastSyncLabel.textContent = `마지막 동기화: ${d.toLocaleString('ko-KR')}`;
    tableFooter.style.display = 'block';
  } else {
    tableFooter.style.display = 'none';
  }
}

// 동기화(저장) 버튼
sheetsSyncBtn.addEventListener('click', async () => {
  if (!sheetsUrl) { openSheetsModal(); return; }

  // 로컬이 비어있으면 불러오기 먼저 제안
  if (entries.length === 0) {
    const choice = confirm(
      '⚠️ 로컬에 매매 기록이 없습니다.\n\n구글 시트에 기존 데이터가 있을 수 있습니다.\n\n[확인] 시트에서 먼저 불러오기\n[취소] 빈 데이터로 덮어쓰기 (시트 데이터 삭제됨)'
    );
    if (choice) {
      await loadFromSheets();
      return;
    }
  }
  await syncToSheets();
});

async function syncToSheets() {
  if (!sheetsUrl) return;

  // 로컬 데이터가 비어있으면 구글 시트 덮어쓰기 방지
  if (entries.length === 0) {
    const go = confirm(
      '⚠️ 로컬에 저장된 매매 기록이 없습니다.\n\n이 상태로 저장하면 구글 시트의 기존 데이터가 모두 삭제됩니다.\n\n[확인] 그래도 저장  [취소] 취소'
    );
    if (!go) return;
  }

  setSyncState('loading');
  sheetsSyncBtn.disabled = true;
  try {
    // Apps Script 웹앱은 POST 시 302 리다이렉트를 내려줌
    // redirect: 'follow' + Content-Type 없이 보내야 CORS 오류 없이 동작
    const res = await fetch(sheetsUrl, {
      method:   'POST',
      redirect: 'follow',
      body:     JSON.stringify({ action: 'save', entries }),
    });

    // Apps Script는 응답 본문이 텍스트이므로 text()로 먼저 받고 JSON 파싱
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('응답 파싱 실패: ' + text.slice(0, 100)); }

    if (data.status === 'ok') {
      setSyncState('synced');
      const now = Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(now));
      updateLastSyncLabel();
    } else {
      throw new Error(data.message || '저장 실패');
    }
  } catch(err) {
    console.error('Sheets sync error:', err);
    setSyncState('error');
    alert('구글 시트 동기화 실패\n\n원인: ' + err.message + '\n\n확인사항:\n1. Apps Script URL이 올바른지 확인\n2. 배포 시 액세스 권한이 "모든 사용자"로 설정됐는지 확인\n3. Apps Script 코드를 최신 버전으로 재배포했는지 확인');
  } finally {
    sheetsSyncBtn.disabled = false;
  }
}

// 구글 시트에서 불러오기
sheetsLoadBtn.addEventListener('click', async () => {
  if (!sheetsUrl) { openSheetsModal(); return; }
  await loadFromSheets();
});

async function loadFromSheets() {
  if (!sheetsUrl) return;
  sheetsLoadBtn.disabled = true;
  sheetsLoadBtn.querySelector('span').textContent = '불러오는 중...';
  try {
    const res = await fetch(sheetsUrl, {
      method:   'POST',
      redirect: 'follow',
      body:     JSON.stringify({ action: 'load' }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('응답 파싱 실패: ' + text.slice(0, 100)); }

    if (data.status !== 'ok') throw new Error(data.message || '불러오기 실패');

    const rows = normalizeRows(data.entries || []);
    if (!rows.length) {
      alert('구글 시트에 저장된 데이터가 없습니다.');
      return;
    }

    const merge = confirm(
      `구글 시트에서 ${rows.length}건을 찾았습니다.\n\n[확인] 기존 데이터에 병합\n[취소] 기존 데이터 교체`
    );
    entries = merge ? mergeEntries(entries, rows) : rows;
    saveEntries();
    renderAll();
    setSyncState('synced');
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    updateLastSyncLabel();
    alert(`불러오기 완료: ${rows.length}건`);

  } catch(err) {
    console.error('Sheets load error:', err);
    alert('구글 시트 불러오기 실패\n\n원인: ' + err.message);
  } finally {
    sheetsLoadBtn.disabled = false;
    sheetsLoadBtn.querySelector('span').textContent = '시트에서 불러오기';
  }
}

// 병합: 시트 데이터를 기준으로 로컬에 없는 항목 추가, 있으면 시트 데이터 우선
function mergeEntries(local, remote) {
  const localMap = new Map(local.map(e => [String(e.id), e]));
  remote.forEach(r => { localMap.set(String(r.id), r); });
  return [...localMap.values()].sort((a, b) => a.createdAt - b.createdAt);
}

// 시트 설정 모달 열기
sheetsConnBtn.addEventListener('click', openSheetsModal);
function openSheetsModal() {
  appsScriptCodeEl.textContent = APPS_SCRIPT_CODE;
  sheetsUrlInput.value = sheetsUrl || '';
  sheetsTestResult.textContent = '';
  sheetsModalBackdrop.style.display = 'flex';
  document.body.classList.add('modal-open');
}
function closeSheetsModal() {
  sheetsModalBackdrop.style.display = 'none';
  document.body.classList.remove('modal-open');
}
sheetsModalClose.addEventListener('click', closeSheetsModal);
sheetsModalBackdrop.addEventListener('click', e => { if (e.target === sheetsModalBackdrop) closeSheetsModal(); });

// 스크립트 코드 복사
copyScriptBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
    copyScriptBtn.textContent = '✓ 복사됨';
    setTimeout(() => { copyScriptBtn.textContent = '복사'; }, 2000);
  });
});

// 연결 저장 + 테스트
sheetsSaveBtn.addEventListener('click', async () => {
  const url = sheetsUrlInput.value.trim();
  if (!url) { sheetsTestResult.textContent = 'URL을 입력해주세요.'; return; }
  if (!url.includes('script.google.com')) {
    sheetsTestResult.textContent = '올바른 Apps Script URL이 아닙니다.';
    return;
  }

  sheetsTestResult.textContent = '연결 테스트 중...';
  sheetsSaveBtn.disabled = true;

  try {
    const res = await fetch(url, {
      method:   'POST',
      redirect: 'follow',
      body:     JSON.stringify({ action: 'ping' }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('응답 파싱 실패'); }
    if (data.status === 'ok') {
      sheetsUrl = url;
      localStorage.setItem(SHEETS_URL_KEY, url);
      setSyncState('pending');
      sheetsTestResult.style.color = 'var(--pnl-pos)';
      sheetsTestResult.textContent = '✓ 연결 성공! 저장되었습니다.';
      setTimeout(closeSheetsModal, 1500);
    } else {
      throw new Error('응답 오류');
    }
  } catch(err) {
    sheetsTestResult.style.color = 'var(--pnl-neg)';
    sheetsTestResult.textContent = '✗ 연결 실패: URL을 다시 확인해 주세요.';
  } finally {
    sheetsSaveBtn.disabled = false;
  }
});

// 연결 해제
sheetsDisconnBtn.addEventListener('click', () => {
  if (!confirm('구글 시트 연결을 해제할까요?')) return;
  sheetsUrl = '';
  localStorage.removeItem(SHEETS_URL_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
  setSyncState('disconnected');
  updateLastSyncLabel();
  closeSheetsModal();
});

/* ===== 리사이즈 시 차트 재그리기 ===== */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderStatsAndChart(), 200);
});

/* ===== 초기 구동 ===== */
function boot() {
  initTheme();
  loadPrinciples();
  loadSettings();
  loadEntries();
  loadSheetsUrl();
  fDate().value     = todayISO();
  fLeverage().value = '1';
  setRangePreset('ALL');
  hookDatePickers();
}

boot();
