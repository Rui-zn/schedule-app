'use strict';

/* 渲染层逻辑：所有数据经 window.scheduleAPI（preload 暴露的 IPC 契约）访问。 */

const api = window.scheduleAPI;

const REPEAT_LABEL = { none: '', daily: '每天', weekly: '每周', monthly: '每月' };

const REMINDER_OPTIONS = [
  { value: '', label: '不提醒' },
  { value: '0', label: '准时' },
  { value: '5', label: '提前 5 分钟' },
  { value: '10', label: '提前 10 分钟' },
  { value: '15', label: '提前 15 分钟' },
  { value: '30', label: '提前 30 分钟' },
  { value: '60', label: '提前 1 小时' },
  { value: '1440', label: '提前 1 天' }
];

const COLORS = ['#4A90D9', '#50C878', '#F5A623', '#E74C3C', '#9B59B6', '#1ABC9C', '#F39C12', '#607D8B'];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const state = {
  page: 'schedule',
  view: 'list',
  monthCursor: startOfMonth(new Date()),
  selectedDate: new Date(),
  categories: [],
  settings: { startMinimized: false, notificationsEnabled: true },
  occurrences: [],
  monthOccurrences: [],
  editingId: null,
  editingCatId: null
};

// ---------- 工具函数 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function sameDay(a, b) { return dateKey(a) === dateKey(b); }
function isToday(d) { return sameDay(d, new Date()); }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(d) { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; }
function weekday(d) { return WEEKDAY_NAMES[d.getDay()]; }
function parseLocal(s) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; }
function defaultNextHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function errorText(err) {
  const m = String((err && err.message) || err);
  return m.replace(/^Error invoking remote method '[^']*': Error: /, '');
}

function toast(msg, type = 'info') {
  const box = document.getElementById('toastBox');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// ---------- DOM 快捷引用 ----------
const $ = (id) => document.getElementById(id);

// ---------- 视图渲染 ----------
function occItemHtml(o) {
  const color = o.categoryColor || '#B0BEC5';
  let timeStr;
  if (o.allDay) {
    timeStr = sameDay(o.start, o.end) ? '全天' : `全天 · ${dateKey(o.start)} ~ ${dateKey(o.end)}`;
  } else {
    timeStr = `${fmtTime(o.start)} – ${fmtTime(o.end)}`;
  }
  const rep = o.repeatType !== 'none' ? `<span class="tag repeat">${REPEAT_LABEL[o.repeatType]}</span>` : '';
  const cat = o.categoryName ? `<span class="tag" style="--c:${esc(o.categoryColor)}">${esc(o.categoryName)}</span>` : '';
  const note = o.note ? `<div class="occ-note">${esc(o.note)}</div>` : '';
  const rem = o.reminderMinutes != null ? ' 🔔' : '';
  return `
  <div class="occ ${o.done ? 'done' : ''}" data-id="${o.scheduleId}" style="--c:${esc(color)}">
    <input type="checkbox" class="occ-check" ${o.done ? 'checked' : ''} title="标记完成" />
    <div class="occ-body">
      <div class="occ-title">${esc(o.title)}${rem}</div>
      <div class="occ-meta"><span>${esc(timeStr)}</span>${rep}${cat}</div>
      ${note}
    </div>
    <div class="occ-actions">
      <button class="icon-btn" data-action="edit" title="编辑">✏️</button>
      <button class="icon-btn" data-action="del" title="删除">🗑</button>
    </div>
  </div>`;
}

function renderList() {
  const groups = new Map();
  for (const o of state.occurrences) {
    const k = dateKey(o.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const view = $('listView');
  if (!groups.size) {
    view.innerHTML = '<div class="empty">暂无日程，点击右上角「新建日程」开始吧 ✨</div>';
    return;
  }
  view.innerHTML = [...groups.entries()].map(([k, items]) => {
    const d = items[0].start;
    const head = `${fmtDate(d)} · ${weekday(d)}${isToday(d) ? '（今天）' : ''}`;
    return `<div class="day-group">
      <h3 class="day-head">${esc(head)}<span class="day-count">${items.length} 项</span></h3>
      ${items.map(occItemHtml).join('')}
    </div>`;
  }).join('');
}

function renderMonth() {
  const cur = state.monthCursor;
  $('monthLabel').textContent = `${cur.getFullYear()}年${cur.getMonth() + 1}月`;
  const first = startOfMonth(cur);
  const gridStart = addDays(first, -first.getDay());

  const byDay = new Map();
  for (const o of state.monthOccurrences) {
    const k = dateKey(o.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(o);
  }

  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const inMonth = d.getMonth() === cur.getMonth();
    const k = dateKey(d);
    const items = byDay.get(k) || [];
    const cls = ['mcell'];
    if (!inMonth) cls.push('other');
    if (isToday(d)) cls.push('today');
    if (sameDay(d, state.selectedDate)) cls.push('sel');
    html += `<div class="${cls.join(' ')}" data-day="${k}">
      <div class="mcell-num">${d.getDate()}</div>
      ${items.slice(0, 3).map((o) => `
        <div class="cal-item ${o.done ? 'done' : ''}" style="--c:${esc(o.categoryColor || '#B0BEC5')}">
          <i class="dot"></i><span>${esc(o.title)}</span>
        </div>`).join('')}
      ${items.length > 3 ? `<div class="cal-more">+${items.length - 3} 更多</div>` : ''}
    </div>`;
  }
  $('monthGrid').innerHTML = html;
  renderDayPanel(byDay.get(dateKey(state.selectedDate)) || []);
}

function renderDayPanel(items) {
  const d = state.selectedDate;
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  $('dayPanel').innerHTML = `
    <div class="day-panel-head">
      <h3>${fmtDate(d)} · ${weekday(d)}</h3>
      <button class="btn primary small" data-action="new-here">＋ 当天新建</button>
    </div>
    ${sorted.length ? sorted.map(occItemHtml).join('') : '<div class="empty small">当天没有日程</div>'}`;
}

// ---------- 数据加载 ----------
async function refresh() {
  if (state.page !== 'schedule') return;
  if (state.view === 'list') await loadList();
  else await loadMonth();
}

async function loadList() {
  try {
    const from = startOfDay(new Date());
    const to = endOfDay(addDays(new Date(), 30));
    state.occurrences = await api.schedules.query({
      from, to,
      keyword: $('searchInput').value.trim() || undefined,
      categoryId: $('categoryFilter').value || undefined,
      includeDone: $('includeDone').checked
    });
    renderList();
  } catch (err) { toast('加载失败：' + errorText(err), 'error'); }
}

async function loadMonth() {
  try {
    // 42 格月历网格（6 周）：查询区间必须覆盖从网格第一天到网格最后一天
    const first = startOfMonth(state.monthCursor);
    const gridStart = addDays(first, -first.getDay());
    const from = startOfDay(gridStart);
    const to = endOfDay(addDays(gridStart, 41));
    state.monthOccurrences = await api.schedules.query({
      from, to,
      keyword: $('searchInput').value.trim() || undefined,
      categoryId: $('categoryFilter').value || undefined,
      includeDone: $('includeDone').checked
    });
    renderMonth();
  } catch (err) { toast('加载失败：' + errorText(err), 'error'); }
}

async function loadCategories() {
  try {
    state.categories = await api.categories.list();
    const filterOpts = `<option value="">全部分类</option>` +
      state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('categoryFilter').innerHTML = filterOpts;
    $('fCategory').innerHTML = `<option value="">无分类</option>` +
      state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    renderCatList();
  } catch (err) { toast('加载分类失败：' + errorText(err), 'error'); }
}

// ---------- 分类页 ----------
function catRowHtml(c) {
  if (state.editingCatId === c.id) {
    return `
    <div class="cat-row editing" data-id="${c.id}">
      <input type="text" class="input cat-edit-name" value="${esc(c.name)}" maxlength="20" />
      <div class="swatches">
        ${COLORS.map((col) => `<span class="sw ${col === c.color ? 'sel' : ''}" data-c="${col}" style="background:${col}"></span>`).join('')}
      </div>
      <div class="cat-actions">
        <button class="btn primary small" data-action="save">保存</button>
        <button class="btn ghost small" data-action="cancel">取消</button>
      </div>
    </div>`;
  }
  return `
  <div class="cat-row" data-id="${c.id}">
    <span class="cat-dot" style="background:${esc(c.color)}"></span>
    <span class="cat-name">${esc(c.name)}</span>
    <div class="cat-actions">
      <button class="icon-btn" data-action="edit" title="编辑">✏️</button>
      <button class="icon-btn" data-action="del" title="删除">🗑</button>
    </div>
  </div>`;
}

function renderCatList() {
  const list = $('catList');
  if (!state.categories.length) {
    list.innerHTML = '<div class="empty small">还没有分类，先添加一个吧 🏷</div>';
    return;
  }
  list.innerHTML = state.categories.map(catRowHtml).join('');
}

function renderCatColorPicker() {
  $('catColors').innerHTML = COLORS.map((col, i) =>
    `<span class="sw ${i === 0 ? 'sel' : ''}" data-c="${col}" style="background:${col}"></span>`
  ).join('');
}

// ---------- 设置页 ----------
function updateAutostartDesc(as) {
  $('autostartDesc').textContent = as.enabled
    ? `已启用 · 快捷方式：${as.shortcutPath}`
    : '未启用（开启后将在启动文件夹创建快捷方式，开机时静默启动到托盘）';
}

function applyAppInfo(info) {
  $('appVersion').textContent = `v${info.version}`;
  $('infoDataPath').textContent = info.dataPath;
  $('infoDbPath').textContent = info.dbPath;
  $('resetDataDir').disabled = !!info.isDefaultDataDir;
}

async function loadSettings() {
  try {
    state.settings = await api.settings.get();
    $('toggleStartMinimized').checked = state.settings.startMinimized;
    $('toggleNotify').checked = state.settings.notificationsEnabled;
    const as = await api.autostart.status();
    $('toggleAutostart').checked = as.enabled;
    updateAutostartDesc(as);
  } catch (err) { toast('加载设置失败：' + errorText(err), 'error'); }
}

// ---------- 日程弹窗 ----------
function fillCategorySelect() {
  $('fCategory').innerHTML = `<option value="">无分类</option>` +
    state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function updateRepeatFields() {
  const repeating = $('fRepeat').value !== 'none';
  $('repeatIntervalField').classList.toggle('hidden', !repeating);
  $('repeatEndField').classList.toggle('hidden', !repeating);
}

function updateAllDayFields() {
  const allDay = $('fAllDay').checked;
  $('fStartTimeField').classList.toggle('hidden', allDay);
  $('fEndTimeField').classList.toggle('hidden', allDay);
}

function updateReminderHint() {
  const allDay = $('fAllDay').checked;
  const hasReminder = $('fReminder').value !== '';
  $('reminderHint').textContent = (allDay && hasReminder) ? '全天日程将在当天 09:00 提醒。' : '';
}

async function openModal(scheduleId = null, presetDate = null) {
  state.editingId = scheduleId;
  $('modalTitle').textContent = scheduleId ? '编辑日程' : '新建日程';
  fillCategorySelect();

  let row = null;
  if (scheduleId) {
    try { row = await api.schedules.get(scheduleId); } catch (err) { toast(errorText(err), 'error'); return; }
    if (!row) { toast('该日程不存在，可能已被删除', 'error'); await refresh(); return; }
  }

  const start = row ? new Date(row.startAt)
    : (presetDate ? new Date(presetDate.getFullYear(), presetDate.getMonth(), presetDate.getDate(), 9, 0, 0) : defaultNextHour());
  const end = row ? new Date(row.endAt) : new Date(start.getTime() + 3600 * 1000);

  $('fTitle').value = row ? row.title : '';
  $('fAllDay').checked = row ? row.allDay : false;
  $('fStartDate').value = dateKey(start);
  $('fStartTime').value = fmtTime(start);
  $('fEndDate').value = dateKey(end);
  $('fEndTime').value = fmtTime(end);
  $('fCategory').value = row && row.categoryId != null ? String(row.categoryId) : '';
  $('fReminder').value = row && row.reminderMinutes != null ? String(row.reminderMinutes) : '';
  $('fRepeat').value = row ? row.repeatType : 'none';
  $('fRepeatInterval').value = row ? row.repeatInterval : 1;
  $('fRepeatEnd').value = row && row.repeatEnd ? row.repeatEnd : '';
  $('fNote').value = row ? row.note : '';

  updateRepeatFields();
  updateAllDayFields();
  updateReminderHint();
  $('modalMask').classList.remove('hidden');
  $('fTitle').focus();
}

function closeModal() {
  $('modalMask').classList.add('hidden');
  state.editingId = null;
}

async function saveModal() {
  const title = $('fTitle').value.trim();
  if (!title) { toast('请输入标题', 'error'); return; }

  const allDay = $('fAllDay').checked;
  const endDate = $('fEndDate').value || $('fStartDate').value;
  let startAt;
  let endAt;
  if (allDay) {
    startAt = parseLocal(`${$('fStartDate').value}T00:00:00`);
    endAt = parseLocal(`${endDate}T23:59:59`);
  } else {
    startAt = parseLocal(`${$('fStartDate').value}T${$('fStartTime').value || '00:00'}:00`);
    endAt = parseLocal(`${endDate}T${$('fEndTime').value || '00:00'}:00`);
  }
  if (!startAt || !endAt) { toast('请填写完整的时间', 'error'); return; }
  if (endAt.getTime() < startAt.getTime()) { toast('结束时间不能早于开始时间', 'error'); return; }

  const repeatType = $('fRepeat').value;
  const data = {
    title,
    allDay,
    startAt,
    endAt,
    categoryId: $('fCategory').value || null,
    repeatType,
    repeatInterval: repeatType === 'none' ? 1 : (parseInt($('fRepeatInterval').value, 10) || 1),
    repeatEnd: repeatType === 'none' ? null : ($('fRepeatEnd').value || null),
    reminderMinutes: $('fReminder').value === '' ? null : parseInt($('fReminder').value, 10),
    note: $('fNote').value.trim()
  };

  try {
    if (state.editingId) await api.schedules.update({ id: state.editingId, ...data });
    else await api.schedules.create(data);
    closeModal();
    toast('已保存');
    await refresh();
  } catch (err) { toast(errorText(err), 'error'); }
}

// ---------- 页面切换 ----------
function switchPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'schedule') refresh();
  if (page === 'categories') loadCategories();
  if (page === 'settings') loadSettings();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('listView').classList.toggle('active', view === 'list');
  $('monthView').classList.toggle('active', view === 'month');
  refresh();
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 导航与视图切换
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => switchPage(b.dataset.page)));
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  // 工具栏
  $('btnNew').addEventListener('click', () => openModal());
  $('categoryFilter').addEventListener('change', refresh);
  $('includeDone').addEventListener('change', refresh);
  let searchTimer = null;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 250);
  });

  // 月历
  $('prevMonth').addEventListener('click', () => {
    state.monthCursor = addMonths(state.monthCursor, -1);
    state.selectedDate = startOfMonth(state.monthCursor);
    loadMonth();
  });
  $('nextMonth').addEventListener('click', () => {
    state.monthCursor = addMonths(state.monthCursor, 1);
    state.selectedDate = startOfMonth(state.monthCursor);
    loadMonth();
  });
  $('todayBtn').addEventListener('click', () => {
    state.monthCursor = startOfMonth(new Date());
    state.selectedDate = new Date();
    loadMonth();
  });
  $('monthGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.mcell');
    if (!cell) return;
    const d = parseLocal(cell.dataset.day);
    if (!d) return;
    state.selectedDate = d;
    if (d.getMonth() !== state.monthCursor.getMonth()) {
      state.monthCursor = startOfMonth(d);
      loadMonth();
    } else {
      renderMonth();
    }
  });

  // 全局日程条目操作（列表 / 月历面板共用）
  document.addEventListener('click', async (e) => {
    const occEl = e.target.closest('.occ');
    if (occEl) {
      const id = Number(occEl.dataset.id);
      if (e.target.closest('.occ-check')) {
        try { await api.schedules.toggleDone(id, e.target.checked); await refresh(); }
        catch (err) { toast(errorText(err), 'error'); }
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') openModal(id);
      if (btn.dataset.action === 'del') {
        if (confirm('确定删除这条日程吗？')) {
          try { await api.schedules.remove(id); toast('已删除'); await refresh(); }
          catch (err) { toast(errorText(err), 'error'); }
        }
      }
      return;
    }
    const nb = e.target.closest('[data-action="new-here"]');
    if (nb) openModal(null, state.selectedDate);
  });

  // 分类页
  $('catAdd').addEventListener('click', async () => {
    const name = $('catName').value.trim();
    if (!name) { toast('请输入分类名称', 'error'); return; }
    const sel = $('catColors').querySelector('.sw.sel');
    try {
      await api.categories.create({ name, color: sel ? sel.dataset.c : COLORS[0] });
      $('catName').value = '';
      toast('分类已添加');
      await loadCategories();
    } catch (err) { toast(errorText(err), 'error'); }
  });
  $('catColors').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (!sw) return;
    $('catColors').querySelectorAll('.sw').forEach((s) => s.classList.remove('sel'));
    sw.classList.add('sel');
  });
  $('catList').addEventListener('click', async (e) => {
    const row = e.target.closest('.cat-row');
    if (!row) return;
    const id = Number(row.dataset.id);
    const sw = e.target.closest('.sw');
    if (sw) {
      row.querySelectorAll('.sw').forEach((s) => s.classList.remove('sel'));
      sw.classList.add('sel');
      return;
    }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'edit') {
      state.editingCatId = id;
      renderCatList();
    } else if (action.dataset.action === 'cancel') {
      state.editingCatId = null;
      renderCatList();
    } else if (action.dataset.action === 'save') {
      const name = row.querySelector('.cat-edit-name').value.trim();
      if (!name) { toast('分类名称不能为空', 'error'); return; }
      const selSw = row.querySelector('.sw.sel');
      try {
        await api.categories.update({ id, name, color: selSw ? selSw.dataset.c : undefined });
        state.editingCatId = null;
        toast('分类已保存');
        await loadCategories();
      } catch (err) { toast(errorText(err), 'error'); }
    } else if (action.dataset.action === 'del') {
      if (confirm('删除该分类？其下日程将变为「无分类」。')) {
        try { await api.categories.remove(id); toast('分类已删除'); await loadCategories(); }
        catch (err) { toast(errorText(err), 'error'); }
      }
    }
  });

  // 设置页
  $('toggleAutostart').addEventListener('change', async () => {
    const want = $('toggleAutostart').checked;
    try {
      const r = await api.autostart.toggle(want);
      $('toggleAutostart').checked = r.enabled;
      updateAutostartDesc(r);
      toast(r.enabled ? '已开启开机自启' : '已关闭开机自启');
    } catch (err) {
      $('toggleAutostart').checked = !want;
      toast('操作失败：' + errorText(err), 'error');
    }
  });
  $('toggleStartMinimized').addEventListener('change', saveSettings);
  $('toggleNotify').addEventListener('change', saveSettings);
  $('openDataDir').addEventListener('click', () => {
    api.app.openDataPath().catch((err) => toast(errorText(err), 'error'));
  });
  $('chooseDataDir').addEventListener('click', async () => {
    try {
      const r = await api.data.chooseDir();
      if (!r) return; // 用户取消
      applyAppInfo(await api.app.info());
      toast(r.moved ? '数据目录已切换（现有数据已移动）' : '数据目录已切换');
      await refresh();
    } catch (err) { toast('切换失败：' + errorText(err), 'error'); }
  });
  $('resetDataDir').addEventListener('click', async () => {
    if (!confirm('恢复默认数据目录（C 盘 %APPDATA%\\日程表）？现有数据将移动回默认目录。')) return;
    try {
      const r = await api.data.resetDir();
      applyAppInfo(await api.app.info());
      toast(r.moved ? '已恢复默认目录（数据已移动回来）' : '已恢复默认目录');
      await refresh();
    } catch (err) { toast('切换失败：' + errorText(err), 'error'); }
  });

  async function saveSettings() {
    try {
      state.settings = await api.settings.set({
        startMinimized: $('toggleStartMinimized').checked,
        notificationsEnabled: $('toggleNotify').checked
      });
      toast('设置已保存');
    } catch (err) { toast(errorText(err), 'error'); }
  }

  // 弹窗
  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalMask').addEventListener('click', (e) => { if (e.target === $('modalMask')) closeModal(); });
  $('modalSave').addEventListener('click', saveModal);
  $('fAllDay').addEventListener('change', () => { updateAllDayFields(); updateReminderHint(); });
  $('fRepeat').addEventListener('change', updateRepeatFields);
  $('fReminder').addEventListener('change', updateReminderHint);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modalMask').classList.contains('hidden')) closeModal();
  });
}

// ---------- 初始化 ----------
async function init() {
  $('weekdays').innerHTML = WEEKDAY_NAMES.map((w) => `<span>${w}</span>`).join('');
  $('fReminder').innerHTML = REMINDER_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  renderCatColorPicker();
  bindEvents();

  try {
    const [info, settings, as] = await Promise.all([api.app.info(), api.settings.get(), api.autostart.status()]);
    state.settings = settings;
    applyAppInfo(info);
    $('toggleStartMinimized').checked = settings.startMinimized;
    $('toggleNotify').checked = settings.notificationsEnabled;
    $('toggleAutostart').checked = as.enabled;
    updateAutostartDesc(as);
    await loadCategories();
    await refresh();
  } catch (err) {
    toast('初始化失败：' + errorText(err), 'error');
  }

  api.onDataChanged(() => {
    loadCategories().catch(() => {});
    refresh().catch(() => {});
  });
}

init();
