/* Baby Schedule - Main Frontend App */

// ===== STATE =====
const state = {
  currentDate: new Date().toISOString().slice(0, 10),
  currentView: 'today',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  user: null,
  entries: [],
  datesWithEntries: [],
  pendingDelete: null,
};

// ===== SOCKET =====
let socket;
function initSocket() {
  socket = io();
  socket.on('entry:created', () => loadEntries());
  socket.on('entry:updated', () => loadEntries());
  socket.on('entry:deleted', () => loadEntries());
  socket.on('user:statusChanged', (data) => {
    if (data.userId === state.user?.id && data.status !== 'approved') {
      window.location.href = '/pending';
    }
  });
}

// ===== HELPERS =====
function fmt12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDatetime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function nowTimeValue() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function sleepTypeLabel(type) {
  const map = { morning_wake: 'Morning Wake-up', nap1: 'Nap 1', nap2: 'Nap 2', nap3: 'Nap 3', nap4: 'Nap 4', night_sleep: 'Night Sleep' };
  return map[type] || type;
}

function diaperLabel(type) {
  const map = { wet: 'Wet', dirty: 'Dirty', both: 'Wet & Dirty' };
  return map[type] || type;
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { window.location.href = '/login'; return; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ===== INIT =====
async function init() {
  try {
    state.user = await api('GET', '/api/auth/me');
  } catch {
    window.location.href = '/login';
    return;
  }
  if (state.user.status !== 'approved') {
    window.location.href = '/pending';
    return;
  }

  document.getElementById('navUsername').textContent = state.user.username;

  // Show baby name prominently at the top
  if (state.user.groupInfo && state.user.groupInfo.babyName) {
    const babyName = state.user.groupInfo.babyName;
    document.getElementById('navBrandName').textContent = `${babyName}'s Schedule`;
    document.getElementById('babyNameTitle').textContent = `${babyName}'s Schedule`;
    document.getElementById('babyNameHeader').classList.remove('hidden');
  }

  // Show admin tab for group_admin and super_admin
  if (state.user.role === 'group_admin' || state.user.role === 'super_admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  setupNavigation();
  setupModals();
  setupForms();
  setupDateNav();
  setupCalendar();
  initSocket();

  renderDateLabel();
  await loadEntries();
  checkReminders();
  setInterval(checkReminders, 5 * 60 * 1000);
}

// ===== NAVIGATION =====
function setupNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');

  if (view === 'admin') loadAdminView();
  if (view === 'calendar') renderCalendar();
}

// ===== DATE NAV =====
function setupDateNav() {
  document.getElementById('prevDay').addEventListener('click', () => changeDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => changeDay(1));
  document.getElementById('todayBtn').addEventListener('click', () => {
    state.currentDate = new Date().toISOString().slice(0, 10);
    renderDateLabel();
    loadEntries();
  });
}

function changeDay(delta) {
  const d = new Date(state.currentDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  state.currentDate = d.toISOString().slice(0, 10);
  renderDateLabel();
  loadEntries();
}

function renderDateLabel() {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(state.currentDate + 'T12:00:00');
  const label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const isToday = state.currentDate === today;
  document.getElementById('currentDateLabel').textContent = isToday ? `Today — ${label}` : label;
}

// ===== LOAD ENTRIES =====
async function loadEntries() {
  try {
    state.entries = await api('GET', `/api/entries/all?date=${state.currentDate}`);
    renderTimeline();
    renderSummary();
  } catch (e) {
    console.error('Failed to load entries', e);
  }
}

// ===== SUMMARY =====
function renderSummary() {
  const sleep = state.entries.filter(e => e.entryType === 'sleep').length;
  const feeding = state.entries.filter(e => e.entryType === 'feeding');
  const totalFeeding = feeding.reduce((sum, e) => sum + e.amount, 0);
  const feedingUnit = feeding.length ? feeding[0].unit : 'ml';
  const diaper = state.entries.filter(e => e.entryType === 'diaper').length;
  const medication = state.entries.filter(e => e.entryType === 'medication').length;

  document.getElementById('summaryCards').innerHTML = `
    <div class="summary-card sleep-card"><div class="s-icon">&#128164;</div><div class="s-value">${sleep}</div><div class="s-label">Sleep sessions</div></div>
    <div class="summary-card feeding-card"><div class="s-icon">&#127868;</div><div class="s-value">${feeding.length ? totalFeeding + feedingUnit : '0'}</div><div class="s-label">Total feeding</div></div>
    <div class="summary-card diaper-card"><div class="s-icon">&#128163;</div><div class="s-value">${diaper}</div><div class="s-label">Diaper changes</div></div>
    <div class="summary-card medication-card"><div class="s-icon">&#128138;</div><div class="s-value">${medication}</div><div class="s-label">Medications</div></div>
  `;
}

// ===== TIMELINE =====
function renderTimeline() {
  const tl = document.getElementById('timeline');
  const empty = document.getElementById('timelineEmpty');

  if (!state.entries.length) {
    tl.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tl.innerHTML = state.entries.map(e => entryHTML(e)).join('');
}

function entryHTML(e) {
  const canEdit = state.user.role === 'super_admin' || state.user.role === 'group_admin' || e.user_id === state.user.id;
  let title = '', meta = '', time = '', reminder = '';

  if (e.entryType === 'sleep') {
    title = sleepTypeLabel(e.type);
    time = fmt12(e.start_time.slice(11, 16) || e.start_time);
    if (e.end_time) meta = `${fmt12(e.start_time.slice(11,16) || e.start_time)} → ${fmt12(e.end_time.slice(11,16) || e.end_time)}`;
    else meta = `Started ${fmt12(e.start_time.slice(11,16) || e.start_time)}`;
  } else if (e.entryType === 'feeding') {
    title = `${e.amount}${e.unit} feeding`;
    time = fmt12(e.time.slice(11,16) || e.time);
    meta = `At ${fmt12(e.time.slice(11,16) || e.time)} by ${e.username}`;
  } else if (e.entryType === 'diaper') {
    title = `${diaperLabel(e.type)} diaper`;
    time = fmt12(e.time.slice(11,16) || e.time);
    meta = `At ${fmt12(e.time.slice(11,16) || e.time)} by ${e.username}`;
  } else if (e.entryType === 'medication') {
    title = `${e.name} — ${e.dosage}`;
    time = fmt12(e.time_administered.slice(11,16) || e.time_administered);
    meta = `Given at ${fmt12(e.time_administered.slice(11,16) || e.time_administered)} by ${e.username}`;
    if (e.next_dose_reminder) {
      reminder = `<div class="entry-reminder">&#9200; Next dose: ${fmtDatetime(e.next_dose_reminder)}</div>`;
    }
  }

  const actions = canEdit ? `
    <div class="entry-actions">
      <button onclick="openEditModal('${e.entryType}', ${e.id})">Edit</button>
      <button class="delete-btn" onclick="confirmDelete('${e.entryType}', ${e.id})">Delete</button>
    </div>` : '';

  const notes = e.notes ? `<div class="entry-notes">"${e.notes}"</div>` : '';

  return `
    <div class="timeline-entry" id="entry-${e.entryType}-${e.id}">
      <div class="entry-dot ${e.entryType}"></div>
      <div class="entry-content">
        <div class="entry-title">${title} <span class="entry-badge ${e.entryType}">${e.entryType}</span></div>
        <div class="entry-meta">${meta}</div>
        ${notes}${reminder}${actions}
      </div>
      <div class="entry-time">${time}</div>
    </div>`;
}

// ===== MODALS =====
function setupModals() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });
  document.getElementById('confirmCancel').addEventListener('click', () => closeModal('confirmModal'));
  document.getElementById('confirmDelete').addEventListener('click', executeDelete);
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  // Set default time to now
  const timeInputs = document.querySelectorAll(`#${id} input[type="time"]`);
  timeInputs.forEach(inp => { if (!inp.value) inp.value = nowTimeValue(); });
  // Sync conditional fields (e.g. hide end time for morning_wake)
  if (id === 'sleepModal') {
    document.getElementById('sleepType').dispatchEvent(new Event('change'));
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Clear form
  const form = document.querySelector(`#${id} form`);
  if (form) {
    form.reset();
    form.querySelectorAll('input[type=hidden]').forEach(i => i.value = '');
    form.querySelectorAll('.alert').forEach(a => a.classList.add('hidden'));
  }
  document.getElementById('dupWarning')?.classList.add('hidden');
  // Re-sync sleep modal fields after reset
  if (id === 'sleepModal') {
    document.getElementById('sleepType').dispatchEvent(new Event('change'));
  }
}

// ===== FORMS =====
function setupForms() {
  document.getElementById('sleepForm').addEventListener('submit', submitSleep);
  document.getElementById('feedingForm').addEventListener('submit', submitFeeding);
  document.getElementById('diaperForm').addEventListener('submit', submitDiaper);
  document.getElementById('medicationForm').addEventListener('submit', submitMedication);

  // Hide end time for morning wake-up and night sleep
  document.getElementById('sleepType').addEventListener('change', function () {
    const isMorning = this.value === 'morning_wake';
    const isNight = this.value === 'night_sleep';
    const hideEnd = isMorning || isNight;
    document.getElementById('sleepEndGroup').classList.toggle('hidden', hideEnd);
    if (hideEnd) document.getElementById('sleepEnd').value = '';
    const note = document.getElementById('morningWakeNote');
    note.classList.toggle('hidden', !hideEnd);
    if (isMorning) note.textContent = 'Duration is calculated automatically from the previous night sleep entry.';
    if (isNight) note.textContent = 'End time is recorded as the morning wake-up of the following day.';
    document.getElementById('sleepStartLabel').textContent = isMorning ? 'Wake-up Time' : isNight ? 'Bedtime' : 'Start Time';
  });

  // Duplicate check on medication name blur
  document.getElementById('medicationName').addEventListener('blur', checkDuplicate);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function submitSleep(e) {
  e.preventDefault();
  const id = document.getElementById('sleepEntryId').value;
  const body = {
    type: document.getElementById('sleepType').value,
    start_time: document.getElementById('sleepStart').value,
    end_time: document.getElementById('sleepEnd').value || null,
    notes: document.getElementById('sleepNotes').value || null,
    date: state.currentDate,
  };
  try {
    if (id) {
      await api('PUT', `/api/entries/sleep/${id}`, body);
    } else {
      await api('POST', '/api/entries/sleep', body);
    }
    closeModal('sleepModal');
    loadEntries();
  } catch (err) {
    showError('sleepError', err.message);
  }
}

async function submitFeeding(e) {
  e.preventDefault();
  const id = document.getElementById('feedingEntryId').value;
  const body = {
    amount: parseFloat(document.getElementById('feedingAmount').value),
    unit: document.getElementById('feedingUnit').value,
    time: document.getElementById('feedingTime').value,
    notes: document.getElementById('feedingNotes').value || null,
    date: state.currentDate,
  };
  try {
    if (id) {
      await api('PUT', `/api/entries/feeding/${id}`, body);
    } else {
      await api('POST', '/api/entries/feeding', body);
    }
    closeModal('feedingModal');
    loadEntries();
  } catch (err) {
    showError('feedingError', err.message);
  }
}

async function submitDiaper(e) {
  e.preventDefault();
  const id = document.getElementById('diaperEntryId').value;
  const typeEl = document.querySelector('input[name="diaperType"]:checked');
  if (!typeEl) { showError('diaperError', 'Please select a type'); return; }
  const body = {
    type: typeEl.value,
    time: document.getElementById('diaperTime').value,
    notes: document.getElementById('diaperNotes').value || null,
    date: state.currentDate,
  };
  try {
    if (id) {
      await api('PUT', `/api/entries/diaper/${id}`, body);
    } else {
      await api('POST', '/api/entries/diaper', body);
    }
    closeModal('diaperModal');
    loadEntries();
  } catch (err) {
    showError('diaperError', err.message);
  }
}

async function submitMedication(e) {
  e.preventDefault();
  const id = document.getElementById('medicationEntryId').value;
  const timeVal = document.getElementById('medicationTime').value;
  const nextDoseVal = document.getElementById('medicationNextDose').value;
  const body = {
    name: document.getElementById('medicationName').value.trim(),
    dosage: document.getElementById('medicationDosage').value.trim(),
    time_administered: `${state.currentDate}T${timeVal}:00`,
    next_dose_reminder: nextDoseVal ? new Date(nextDoseVal).toISOString() : null,
    notes: document.getElementById('medicationNotes').value || null,
    date: state.currentDate,
  };
  try {
    if (id) {
      await api('PUT', `/api/entries/medication/${id}`, body);
    } else {
      await api('POST', '/api/entries/medication', body);
    }
    closeModal('medicationModal');
    loadEntries();
  } catch (err) {
    showError('medicationError', err.message);
  }
}

async function checkDuplicate() {
  const name = document.getElementById('medicationName').value.trim();
  if (!name) return;
  const warn = document.getElementById('dupWarning');
  try {
    const data = await api('POST', '/api/entries/medication/check-duplicate', { name });
    if (data.duplicate) {
      warn.textContent = '⚠️ ' + data.warning;
      warn.classList.remove('hidden');
    } else {
      warn.classList.add('hidden');
    }
  } catch { warn.classList.add('hidden'); }
}

// ===== EDIT ENTRIES =====
async function openEditModal(type, id) {
  const entry = state.entries.find(e => e.entryType === type && e.id === id);
  if (!entry) return;

  if (type === 'sleep') {
    document.getElementById('sleepEntryId').value = id;
    document.getElementById('sleepType').value = entry.type;
    document.getElementById('sleepStart').value = (entry.start_time || '').slice(11, 16) || entry.start_time;
    document.getElementById('sleepEnd').value = entry.end_time ? ((entry.end_time || '').slice(11, 16) || entry.end_time) : '';
    document.getElementById('sleepNotes').value = entry.notes || '';
    // Trigger visibility toggle for morning_wake
    document.getElementById('sleepType').dispatchEvent(new Event('change'));
    openModal('sleepModal');
  } else if (type === 'feeding') {
    document.getElementById('feedingEntryId').value = id;
    document.getElementById('feedingAmount').value = entry.amount;
    document.getElementById('feedingUnit').value = entry.unit;
    document.getElementById('feedingTime').value = (entry.time || '').slice(11, 16) || entry.time;
    document.getElementById('feedingNotes').value = entry.notes || '';
    openModal('feedingModal');
  } else if (type === 'diaper') {
    document.getElementById('diaperEntryId').value = id;
    const radio = document.querySelector(`input[name="diaperType"][value="${entry.type}"]`);
    if (radio) radio.checked = true;
    document.getElementById('diaperTime').value = (entry.time || '').slice(11, 16) || entry.time;
    document.getElementById('diaperNotes').value = entry.notes || '';
    openModal('diaperModal');
  } else if (type === 'medication') {
    document.getElementById('medicationEntryId').value = id;
    document.getElementById('medicationName').value = entry.name;
    document.getElementById('medicationDosage').value = entry.dosage;
    document.getElementById('medicationTime').value = (entry.time_administered || '').slice(11, 16);
    if (entry.next_dose_reminder) {
      const d = new Date(entry.next_dose_reminder);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('medicationNextDose').value = local;
    }
    document.getElementById('medicationNotes').value = entry.notes || '';
    openModal('medicationModal');
  }
}

// ===== DELETE =====
function confirmDelete(type, id) {
  state.pendingDelete = { type, id };
  openModal('confirmModal');
}

async function executeDelete() {
  if (!state.pendingDelete) return;
  const { type, id } = state.pendingDelete;
  try {
    await api('DELETE', `/api/entries/${type}/${id}`);
    closeModal('confirmModal');
    state.pendingDelete = null;
    loadEntries();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ===== REMINDERS =====
async function checkReminders() {
  try {
    const reminders = await api('GET', '/api/entries/medication/reminders');
    const banner = document.getElementById('reminderBanner');
    if (reminders.length) {
      banner.innerHTML = '&#9200; Upcoming medications: ' + reminders.map(r =>
        `<strong>${r.name}</strong> (${r.dosage}) due at ${fmtDatetime(r.next_dose_reminder)} — given by ${r.username}`
      ).join(' &bull; ');
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch { }
}

// ===== CALENDAR =====
function setupCalendar() {
  document.getElementById('calPrevMonth').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
    renderCalendar();
  });
  document.getElementById('calNextMonth').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
    renderCalendar();
  });
}

async function renderCalendar() {
  document.getElementById('calMonthLabel').textContent =
    new Date(state.calYear, state.calMonth - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

  let datesWithEntries = [];
  try {
    datesWithEntries = await api('GET', `/api/entries/calendar/${state.calYear}/${state.calMonth}`);
  } catch { }

  const todayStr = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(state.calYear, state.calMonth - 1, 1).getDay();
  const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();
  const daysInPrevMonth = new Date(state.calYear, state.calMonth - 1, 0).getDate();

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = `<div class="cal-weekdays">${weekdays.map(d => `<div class="cal-weekday">${d}</div>`).join('')}</div><div class="cal-days">`;

  // Prev month filler
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${daysInPrevMonth - i}</div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${state.calYear}-${String(state.calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasEntries = datesWithEntries.includes(dateStr);
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === state.currentDate;
    let cls = 'cal-day';
    if (hasEntries) cls += ' has-entries';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';
    html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
  }

  // Next month filler
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let i = 1; i <= totalCells - firstDay - daysInMonth; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }

  html += '</div>';
  document.getElementById('calendarGrid').innerHTML = html;

  document.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      state.currentDate = el.dataset.date;
      switchView('today');
      renderDateLabel();
      loadEntries();
    });
  });
}

// ===== ADMIN =====
function loadAdminView() {
  if (state.user.role === 'super_admin') {
    document.getElementById('superAdminPanel').classList.remove('hidden');
    document.getElementById('groupAdminPanel').classList.add('hidden');
    // Show setup form if super_admin has no group yet
    const noGroup = !state.user.groupId;
    document.getElementById('myGroupSetup').classList.toggle('hidden', !noGroup);
    loadAdminGroups();
  } else {
    document.getElementById('superAdminPanel').classList.add('hidden');
    document.getElementById('groupAdminPanel').classList.remove('hidden');
    loadAdminUsers();
  }
}

async function createMyGroup() {
  const name = document.getElementById('myGroupName').value.trim();
  const baby_name = document.getElementById('myBabyName').value.trim();
  if (!name || !baby_name) return alert('Please fill in both fields');
  try {
    const result = await api('POST', '/api/admin/my-group', { name, baby_name });
    // Reload page to get a fresh session with the new groupId
    window.location.reload();
  } catch (err) { alert(err.message); }
}

async function loadAdminGroups() {
  try {
    const groups = await api('GET', '/api/admin/groups');
    const pending = groups.filter(g => g.status === 'pending');

    const pendingEl = document.getElementById('pendingGroups');
    const allEl = document.getElementById('allGroups');

    if (!pending.length) {
      pendingEl.innerHTML = '<div class="user-actions-empty">No pending group registrations</div>';
    } else {
      pendingEl.innerHTML = pending.map(g => groupCardHTML(g)).join('');
    }

    allEl.innerHTML = groups.map(g => groupCardHTML(g)).join('');
  } catch (err) {
    console.error('Failed to load groups', err);
  }
}

function groupCardHTML(g) {
  const actions = g.status === 'pending' ? `
    <button class="btn btn-sm btn-primary" onclick="approveGroup(${g.id})">Approve</button>
    <button class="btn btn-sm btn-danger" onclick="rejectGroup(${g.id})">Reject</button>` :
    g.status === 'approved' ? `<button class="btn btn-sm btn-secondary" onclick="rejectGroup(${g.id})">Revoke</button>` :
    `<button class="btn btn-sm btn-primary" onclick="approveGroup(${g.id})">Re-approve</button>`;

  const escapedName = g.name.replace(/'/g, "\\'");
  const escapedBaby = g.baby_name.replace(/'/g, "\\'");
  return `<div class="user-card" id="group-card-${g.id}">
    <div class="user-info">
      <div class="user-name">${g.name}</div>
      <div class="user-email">Baby: <strong>${g.baby_name}</strong></div>
      <div class="user-meta">Admin: ${g.admin_username || 'none'} &bull; Created ${new Date(g.created_at).toLocaleDateString()}</div>
    </div>
    <span class="status-badge ${g.status}">${g.status}</span>
    <div class="user-actions">
      ${actions}
      <button class="btn btn-sm btn-ghost" onclick="loadGroupUsers(${g.id}, '${escapedName}')">&#128100; Users</button>
      <button class="btn btn-sm btn-ghost" onclick="toggleRenameForm(${g.id})">&#9998; Rename</button>
    </div>
    <div id="rename-form-${g.id}" class="rename-form hidden">
      <input type="text" id="rename-group-${g.id}" placeholder="Group name" value="${g.name}" class="form-input rename-input">
      <input type="text" id="rename-baby-${g.id}" placeholder="Baby name" value="${g.baby_name}" class="form-input rename-input">
      <div class="rename-actions">
        <button class="btn btn-sm btn-primary" onclick="saveGroupRename(${g.id})">Save</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleRenameForm(${g.id})">Cancel</button>
      </div>
    </div>
  </div>`;
}

async function approveGroup(id) {
  try {
    await api('POST', `/api/admin/groups/${id}/approve`);
    loadAdminGroups();
  } catch (err) { alert(err.message); }
}

async function rejectGroup(id) {
  try {
    await api('POST', `/api/admin/groups/${id}/reject`);
    loadAdminGroups();
  } catch (err) { alert(err.message); }
}

function toggleRenameForm(id) {
  document.getElementById(`rename-form-${id}`).classList.toggle('hidden');
}

async function saveGroupRename(id) {
  const name = document.getElementById(`rename-group-${id}`).value.trim();
  const baby_name = document.getElementById(`rename-baby-${id}`).value.trim();
  if (!name || !baby_name) return alert('Both fields are required');
  try {
    await api('PUT', `/api/admin/groups/${id}/rename`, { name, baby_name });
    loadAdminGroups();
  } catch (err) { alert(err.message); }
}

let currentGroupId = null;

async function loadGroupUsers(groupId, groupName) {
  currentGroupId = groupId;
  try {
    const users = await api('GET', `/api/admin/groups/${groupId}/users`);
    document.getElementById('groupUsersTitle').textContent = `${groupName} — Users`;
    document.getElementById('groupUsersList').innerHTML = users.length
      ? users.map(u => `<div class="user-card">
          <div class="user-info">
            <div class="user-name">${u.username}</div>
            <div class="user-email">${u.email}</div>
            <div class="user-meta">${u.role} &bull; <span class="status-badge ${u.status}">${u.status}</span></div>
          </div>
          <div class="user-actions">
            <button class="btn btn-sm btn-danger" onclick="removeUserFromGroup(${u.id})">Remove</button>
          </div>
        </div>`).join('')
      : '<div class="user-actions-empty">No users in this group</div>';
    document.getElementById('allGroupsSection').classList.add('hidden');
    document.getElementById('pendingGroupsSection').classList.add('hidden');
    document.getElementById('groupUsersPanel').classList.remove('hidden');
  } catch (err) { alert(err.message); }
}

async function removeUserFromGroup(userId) {
  if (!confirm('Remove this user from the group? They will lose access.')) return;
  try {
    await api('POST', `/api/admin/users/${userId}/remove-from-group`);
    loadGroupUsers(currentGroupId, document.getElementById('groupUsersTitle').textContent.split(' —')[0]);
  } catch (err) { alert(err.message); }
}

function closeGroupUsers() {
  currentGroupId = null;
  document.getElementById('groupUsersPanel').classList.add('hidden');
  document.getElementById('allGroupsSection').classList.remove('hidden');
  document.getElementById('pendingGroupsSection').classList.remove('hidden');
}

async function loadAdminUsers() {
  try {
    const users = await api('GET', '/api/admin/users');
    const pending = users.filter(u => u.status === 'pending');

    const pendingEl = document.getElementById('pendingUsers');
    const allEl = document.getElementById('allUsers');

    pendingEl.innerHTML = pending.length
      ? pending.map(u => userCardHTML(u)).join('')
      : '<div class="user-actions-empty">No pending requests</div>';

    allEl.innerHTML = users.map(u => userCardHTML(u)).join('');
  } catch (err) {
    console.error('Failed to load users', err);
  }
}

function userCardHTML(u) {
  const isSelf = u.id === state.user.id;
  let actions = '';
  if (!isSelf) {
    if (u.status === 'pending') {
      actions = `
        <button class="btn btn-sm btn-primary" onclick="approveUser(${u.id})">Approve</button>
        <button class="btn btn-sm btn-danger" onclick="rejectUser(${u.id})">Reject</button>`;
    } else if (u.status === 'approved') {
      actions = `
        <button class="btn btn-sm btn-secondary" onclick="rejectUser(${u.id})">Revoke</button>
        ${u.role === 'caregiver' ? `<button class="btn btn-sm btn-secondary" onclick="setUserRole(${u.id}, 'group_admin')">Make Admin</button>` : `<button class="btn btn-sm btn-secondary" onclick="setUserRole(${u.id}, 'caregiver')">Remove Admin</button>`}
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Delete</button>`;
    } else {
      actions = `
        <button class="btn btn-sm btn-primary" onclick="approveUser(${u.id})">Re-approve</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Delete</button>`;
    }
  }

  return `<div class="user-card">
    <div class="user-info">
      <div class="user-name">${u.username} ${isSelf ? '<em>(you)</em>' : ''}</div>
      <div class="user-email">${u.email}</div>
      <div class="user-meta">Joined ${new Date(u.created_at).toLocaleDateString()}</div>
    </div>
    <span class="role-badge">${u.role}</span>
    <span class="status-badge ${u.status}">${u.status}</span>
    <div class="user-actions">${actions}</div>
  </div>`;
}

async function approveUser(id) {
  try {
    await api('POST', `/api/admin/users/${id}/approve`);
    loadAdminUsers();
  } catch (err) { alert(err.message); }
}

async function rejectUser(id) {
  try {
    await api('POST', `/api/admin/users/${id}/reject`);
    loadAdminUsers();
  } catch (err) { alert(err.message); }
}

async function setUserRole(id, role) {
  try {
    await api('PUT', `/api/admin/users/${id}/role`, { role });
    loadAdminUsers();
  } catch (err) { alert(err.message); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/admin/users/${id}`);
    loadAdminUsers();
  } catch (err) { alert(err.message); }
}

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
