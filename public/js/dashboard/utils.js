/* Shared helpers used across the staff dashboard views. Loaded as a plain
   (non-module) script so every view file can use these as globals.
   Note: escapeHtml() is defined once in api.js (loaded before this file). */

// --- Date / time helpers ----------------------------------------------------
const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function todayStr() {
  return formatDateStr(new Date());
}

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, (m - 1), d + days);
  return formatDateStr(date);
}

function weekdayKeyFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return WEEKDAY_KEYS[date.getDay()];
}

function formatDateHuman(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function minutesFromTime(time) {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeFromMinutes(totalMinutes) {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function roundToStep(minutes, step) {
  return Math.round(minutes / step) * step;
}

// Resolves opening hours for a given date, honoring per-date overrides in settings.specialHours.
function openingHoursFor(settings, dateStr) {
  const overrides = Array.isArray(settings.specialHours) ? settings.specialHours : [];
  const override = overrides.find((entry) => entry.date === dateStr);
  if (override) {
    if (override.closed) return null;
    return { open: override.open, close: override.close };
  }
  const weekly = settings.openingHours?.[weekdayKeyFor(dateStr)];
  if (!weekly || !weekly.open || !weekly.close) return null;
  return weekly;
}

// --- Custom 24h time <select> component -------------------------------------
// Native <input type="time"> renders using the OS/browser locale (12h AM/PM in
// many Chrome setups), which doesn't match Czech 24h conventions (midnight =
// "00:00", not "12:00 AM"). These selects always show plain "HH:MM" text.
function allDayTimes(step = 15) {
  const times = [];
  for (let m = 0; m < 24 * 60; m += step) times.push(timeFromMinutes(m));
  return times;
}

function timeSelectHtml(id, times, selected, { label } = {}) {
  const hasOptions = times.length > 0;
  const options = hasOptions
    ? times.map((t) => `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')
    : '<option value="">–</option>';
  return `
    <div class="time-select-group${hasOptions ? '' : ' unavailable'}">
      <select id="${id}" ${hasOptions ? '' : 'disabled'} aria-label="${escapeHtml(label ?? 'Čas')}">${options}</select>
    </div>`;
}

// Same as timeSelectHtml but supports an extra raw attribute string (e.g. a
// data-* selector hook) and an explicit disabled flag, used by settings forms
// that look selects up by data attribute instead of id.
function timeSelectGroupHtml(id, times, selected, { dataAttr = '', disabled = false } = {}) {
  const options = times.map((t) => `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  return `
    <div class="time-select-group">
      <select id="${id}" ${dataAttr} ${disabled ? 'disabled' : ''}>${options}</select>
    </div>`;
}

// Replaces a <select>'s options in place (used when resource/date/start changes).
function renderTimeSelectOptions(selectEl, times, selected) {
  const hasOptions = times.length > 0;
  selectEl.disabled = !hasOptions;
  selectEl.closest('.time-select-group')?.classList.toggle('unavailable', !hasOptions);
  selectEl.innerHTML = hasOptions
    ? times.map((t) => `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')
    : '<option value="">–</option>';
}

// --- Reservation slot availability -------------------------------------------
// Every helper below only considers active (non cancelled/no_show) reservations
// for the given table, so already-booked time ranges can never be re-selected.
function reservationsForResourceDate(resourceId, date, excludeId) {
  return Store.reservations.filter(
    (r) => r.resourceId === resourceId && r.date === date && r.id !== excludeId && !['cancelled', 'no_show'].includes(r.status)
  );
}

function computeAvailableStarts({ resourceId, date, excludeId }) {
  const hours = openingHoursFor(Store.settings, date);
  if (!hours || !resourceId) return [];

  const openMinutes = minutesFromTime(hours.open);
  const closeMinutes = minutesFromTime(hours.close);
  const step = Number(Store.settings.slotMinutes) || 30;
  const minDuration = Number(Store.settings.minimumReservationMinutes) || step;
  const lead = Number(Store.settings.minimumLeadMinutes) || 0;

  const busy = reservationsForResourceDate(resourceId, date, excludeId).map((r) => ({
    start: minutesFromTime(r.startTime),
    end: minutesFromTime(r.endTime)
  }));

  const isToday = date === todayStr();
  const now = new Date();
  const earliestMinutes = isToday ? now.getHours() * 60 + now.getMinutes() + lead : -Infinity;

  const starts = [];
  for (let m = openMinutes; m + minDuration <= closeMinutes; m += step) {
    if (m < earliestMinutes) continue;
    const overlaps = busy.some((b) => m < b.end && m + minDuration > b.start);
    if (!overlaps) starts.push(timeFromMinutes(m));
  }
  return starts;
}

function computeAvailableEnds({ resourceId, date, start, excludeId }) {
  const hours = openingHoursFor(Store.settings, date);
  if (!hours || !start || !resourceId) return [];

  const closeMinutes = minutesFromTime(hours.close);
  const step = Number(Store.settings.slotMinutes) || 30;
  const minDuration = Number(Store.settings.minimumReservationMinutes) || step;
  const maxDuration = Number(Store.settings.maximumReservationMinutes) || 240;
  const startMinutes = minutesFromTime(start);

  const nextBusyStart = reservationsForResourceDate(resourceId, date, excludeId)
    .map((r) => minutesFromTime(r.startTime))
    .filter((s) => s >= startMinutes)
    .sort((a, b) => a - b)[0] ?? closeMinutes;

  const limit = Math.min(closeMinutes, startMinutes + maxDuration, nextBusyStart);

  const ends = [];
  for (let m = startMinutes + minDuration; m <= limit; m += step) {
    ends.push(timeFromMinutes(m));
  }
  return ends;
}

// Walks forward from `fromDate` to find the first date+time with a free slot.
function findNearestAvailableSlot(resourceId, fromDate = todayStr(), maxDays = 60) {
  for (let i = 0; i < maxDays; i += 1) {
    const date = addDaysStr(fromDate, i);
    const starts = computeAvailableStarts({ resourceId, date });
    if (starts.length > 0) {
      const start = starts[0];
      const ends = computeAvailableEnds({ resourceId, date, start });
      return { date, start, end: ends[0] ?? start };
    }
  }
  return { date: fromDate, start: '12:00', end: '13:00' };
}

// --- Reservation status -> readable Czech label ----------------------------
const STATUS_LABELS = {
  pending: 'Čeká',
  confirmed: 'Potvrzeno',
  checked_in: 'Přítomen',
  completed: 'Dokončeno',
  cancelled: 'Zrušeno',
  no_show: 'Nedostavil se',
  archived: 'Archivováno'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function statusBadgeHtml(status) {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

// A reservation counts as "archived" once its full duration has elapsed.
function isReservationPast(reservation) {
  const end = new Date(`${reservation.date}T${reservation.endTime || '23:59'}:00`);
  return end.getTime() < Date.now();
}

// --- Tiny toast helper (in addition to the inline #message banner) --------
function toast(text, type = 'success') {
  const el = document.getElementById('message');
  if (el) showMessage(el, text, type);
}

// --- Minimal modal dialog helper --------------------------------------------
function openModal(title, bodyHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="modal-close" aria-label="Zavřít">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  root.hidden = false;
  const close = () => closeModal();
  root.querySelector('.modal-close').addEventListener('click', close);
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) close();
  });
  return root.querySelector('.modal-body');
}

function closeModal() {
  const root = document.getElementById('modal-root');
  root.hidden = true;
  root.innerHTML = '';
}

// --- Tiny dependency-free SVG bar chart --------------------------------------
function renderBarChart(container, data, { max, valueSuffix = '' } = {}) {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));
  const width = 320;
  const height = 120;
  const barGap = 8;
  const barWidth = data.length ? (width - barGap * (data.length - 1)) / data.length : width;

  const bars = data
    .map((d, i) => {
      const barHeight = peak > 0 ? Math.max(2, (d.value / peak) * (height - 24)) : 2;
      const x = i * (barWidth + barGap);
      const y = height - 20 - barHeight;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" class="chart-bar"></rect>
          <text x="${x + barWidth / 2}" y="${height - 20 - barHeight - 4}" text-anchor="middle" class="chart-value">${escapeHtml(String(d.value))}${escapeHtml(valueSuffix)}</text>
          <text x="${x + barWidth / 2}" y="${height - 4}" text-anchor="middle" class="chart-label">${escapeHtml(d.label)}</text>
        </g>`;
    })
    .join('');

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="bar-chart" role="img" aria-label="graf">${bars}</svg>`;
}

function renderProgressBar(container, percent, label) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  container.innerHTML = `
    <div class="progress-row">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${escapeHtml(label ?? `${pct}%`)}</span>
    </div>`;
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
