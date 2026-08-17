const resourceSelect = document.getElementById('resourceId');
const dateInput = document.getElementById('date');
const startTimeSelect = document.getElementById('startTime');
const endTimeSelect = document.getElementById('endTime');
const form = document.getElementById('reserve-form');
const messageEl = document.getElementById('message');
const confirmationEl = document.getElementById('confirmation');
const hintEl = document.getElementById('availability-hint');

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return formatDateStr(new Date());
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return formatDateStr(date);
}

function weekdayKeyFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return WEEKDAY_KEYS[date.getDay()];
}

function minutesFromTime(time) {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function timeFromMinutes(totalMinutes) {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

let appSettings = {};
let appResources = [];
let bookedSlots = [];

// Prevent choosing past dates in the browser's date picker
dateInput.min = todayStr();
if (!dateInput.value) dateInput.value = todayStr();

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

function getBusyIntervals(resourceId, date) {
  const cleanup = Number(appSettings.cleanupMinutes) || 0;
  return bookedSlots
    .filter((s) => s.resourceId === resourceId && s.date === date)
    .map((s) => ({
      start: minutesFromTime(s.startTime),
      end: minutesFromTime(s.endTime) + cleanup
    }));
}

function computeAvailableStarts(resourceId, date) {
  const hours = openingHoursFor(appSettings, date);
  if (!hours || !resourceId) return [];

  const openMinutes = minutesFromTime(hours.open);
  const closeMinutes = minutesFromTime(hours.close);
  const step = Number(appSettings.slotMinutes) || 30;
  const minDuration = Number(appSettings.minimumReservationMinutes) || step;
  const lead = Number(appSettings.minimumLeadMinutes) || 0;
  const cleanup = Number(appSettings.cleanupMinutes) || 0;

  const busy = getBusyIntervals(resourceId, date);

  const isToday = date === todayStr();
  const now = new Date();
  const earliestMinutes = isToday ? now.getHours() * 60 + now.getMinutes() + lead : -Infinity;

  const starts = [];
  for (let m = openMinutes; m + minDuration <= closeMinutes; m += step) {
    if (m < earliestMinutes) continue;
    const overlaps = busy.some((b) => m < b.end && m + minDuration + cleanup > b.start);
    if (!overlaps) starts.push(timeFromMinutes(m));
  }
  return starts;
}

function computeAvailableEnds(resourceId, date, start) {
  const hours = openingHoursFor(appSettings, date);
  if (!hours || !start || !resourceId) return [];

  const closeMinutes = minutesFromTime(hours.close);
  const step = Number(appSettings.slotMinutes) || 30;
  const minDuration = Number(appSettings.minimumReservationMinutes) || step;
  const maxDuration = Number(appSettings.maximumReservationMinutes) || 240;
  const cleanup = Number(appSettings.cleanupMinutes) || 0;
  const startMinutes = minutesFromTime(start);

  const nextBusyStart = getBusyIntervals(resourceId, date)
    .map((b) => b.start)
    .filter((s) => s >= startMinutes)
    .sort((a, b) => a - b)[0] ?? closeMinutes;

  const limit = Math.min(closeMinutes, startMinutes + maxDuration, nextBusyStart - cleanup);

  const ends = [];
  for (let m = startMinutes + minDuration; m <= limit; m += step) {
    ends.push(timeFromMinutes(m));
  }
  return ends;
}

function findNearestAvailableSlot(resourceId, fromDate = todayStr(), maxDays = 60) {
  for (let i = 0; i < maxDays; i += 1) {
    const date = addDaysStr(fromDate, i);
    const starts = computeAvailableStarts(resourceId, date);
    if (starts.length > 0) {
      const start = starts[0];
      const ends = computeAvailableEnds(resourceId, date, start);
      return { date, start, end: ends[0] ?? start };
    }
  }
  return null;
}

function renderSelectOptions(selectEl, times, selected) {
  const hasOptions = times.length > 0;
  selectEl.disabled = !hasOptions;
  selectEl.closest('.time-select-group')?.classList.toggle('unavailable', !hasOptions);
  selectEl.innerHTML = hasOptions
    ? times.map((t) => `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')
    : '<option value="">–</option>';
}

function refreshTimeSlots() {
  const resourceId = resourceSelect.value;
  const date = dateInput.value;

  if (date < todayStr()) {
    hintEl.textContent = 'Nelze rezervovat termín v minulosti. Vyberte dnešní nebo budoucí datum.';
    hintEl.className = 'field-hint message error';
    renderSelectOptions(startTimeSelect, [], '');
    renderSelectOptions(endTimeSelect, [], '');
    return;
  }

  const starts = computeAvailableStarts(resourceId, date);

  if (starts.length === 0) {
    const nearest = findNearestAvailableSlot(resourceId, date);
    if (nearest) {
      hintEl.innerHTML = `Tento den je pro vybraný stůl plně obsazen nebo zavřen. Nejbližší volný termín je <strong>${escapeHtml(nearest.date)} (${escapeHtml(nearest.start)})</strong>.`;
    } else {
      hintEl.textContent = 'Pro vybraný stůl a datum nejsou k dispozici žádné volné termíny.';
    }
    hintEl.className = 'field-hint message error';
    renderSelectOptions(startTimeSelect, [], '');
    renderSelectOptions(endTimeSelect, [], '');
    return;
  }

  hintEl.textContent = '';
  hintEl.className = 'field-hint';

  const chosenStart = starts.includes(startTimeSelect.value) ? startTimeSelect.value : starts[0];
  renderSelectOptions(startTimeSelect, starts, chosenStart);

  const ends = computeAvailableEnds(resourceId, date, chosenStart);
  const chosenEnd = ends.includes(endTimeSelect.value) ? endTimeSelect.value : ends[0];
  renderSelectOptions(endTimeSelect, ends, chosenEnd);
}

function handleStartChange() {
  const resourceId = resourceSelect.value;
  const date = dateInput.value;
  const ends = computeAvailableEnds(resourceId, date, startTimeSelect.value);
  const chosenEnd = ends.includes(endTimeSelect.value) ? endTimeSelect.value : ends[0];
  renderSelectOptions(endTimeSelect, ends, chosenEnd);
}

resourceSelect.addEventListener('change', () => {
  const resourceId = resourceSelect.value;
  const starts = computeAvailableStarts(resourceId, dateInput.value);
  if (starts.length === 0) {
    const nearest = findNearestAvailableSlot(resourceId, dateInput.value);
    if (nearest) {
      dateInput.value = nearest.date;
    }
  }
  refreshTimeSlots();
});

dateInput.addEventListener('change', refreshTimeSlots);
startTimeSelect.addEventListener('change', handleStartChange);

async function init() {
  try {
    const [resourcesRes, settingsRes, availRes] = await Promise.all([
      apiRequest('/api/user/reservation/resources'),
      apiRequest('/api/user/settings'),
      apiRequest('/api/user/reservation/availability')
    ]);

    appResources = resourcesRes.resources.filter((r) => r.status !== 'disabled');
    appSettings = settingsRes.settings;
    bookedSlots = availRes.slots ?? [];

    resourceSelect.innerHTML = appResources
      .map(
        (r) =>
          `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} - ${escapeHtml(r.zone)} (${escapeHtml(String(r.minGuests))}–${escapeHtml(String(r.maxGuests))} osob)</option>`
      )
      .join('');

    const defaultResource = appResources[0]?.id;
    if (defaultResource) {
      const nearest = findNearestAvailableSlot(defaultResource, todayStr());
      if (nearest) {
        dateInput.value = nearest.date;
      }
    }

    refreshTimeSlots();
  } catch (error) {
    showMessage(messageEl, `Could not load data: ${error.message}`, 'error');
  }
}

const bookingCard = document.getElementById('booking-card');
const verificationCard = document.getElementById('verification-card');
const verifyForm = document.getElementById('verify-form');
const verifyCodeInput = document.getElementById('verify-code');
const verifyEmailDisplay = document.getElementById('verify-email-display');
const verifyBackBtn = document.getElementById('verify-back-btn');

let currentPendingReservationId = null;

function showConfirmation(reservation) {
  bookingCard.hidden = true;
  verificationCard.hidden = true;
  document.getElementById('confirm-reservation-id').textContent = reservation.id;
  document.getElementById('confirm-resource-id').textContent = reservation.resourceId;
  document.getElementById('manage-link').href = `/reserve/manage?resource=${encodeURIComponent(reservation.resourceId)}&reservation=${encodeURIComponent(reservation.id)}`;
  confirmationEl.hidden = false;
}

verifyBackBtn.addEventListener('click', () => {
  verificationCard.hidden = true;
  bookingCard.hidden = false;
  messageEl.hidden = true;
});

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageEl.hidden = true;
  const code = verifyCodeInput.value.trim();
  if (!code || !currentPendingReservationId) {
    showMessage(messageEl, 'Zadejte 6místný kód.', 'error');
    return;
  }

  try {
    const res = await apiRequest('/api/user/reserve/verify', {
      method: 'POST',
      body: { reservationId: currentPendingReservationId, code }
    });
    showMessage(messageEl, 'Rezervace byla úspěšně ověřena a potvrzena.', 'success');
    showConfirmation(res.reservation);
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageEl.hidden = true;
  confirmationEl.hidden = true;

  const resourceId = resourceSelect.value;
  const startTime = startTimeSelect.value;
  const endTime = endTimeSelect.value;
  const email = document.getElementById('email').value.trim();

  if (!startTime || !endTime) {
    showMessage(messageEl, 'Vyberte platný čas rezervace.', 'error');
    return;
  }

  const payload = {
    date: dateInput.value,
    startTime,
    endTime,
    guestCount: Number(document.getElementById('guestCount').value),
    guestName: document.getElementById('guestName').value,
    email,
    phone: document.getElementById('phone').value,
    notes: document.getElementById('notes').value || undefined
  };

  try {
    const res = await apiRequest(`/api/user/reserve/${resourceId}`, { method: 'POST', body: payload });
    currentPendingReservationId = res.reservation.id;
    verifyEmailDisplay.textContent = email;
    verifyCodeInput.value = '';
    bookingCard.hidden = true;
    verificationCard.hidden = false;
    showMessage(messageEl, 'Ověřovací kód a odkaz byly odeslány na Váš e-mail.', 'success');
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

async function checkUrlVerification() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verifyToken');
  if (verifyToken) {
    try {
      const res = await apiRequest(`/api/user/reserve/verify?token=${encodeURIComponent(verifyToken)}`);
      showMessage(messageEl, 'Váš e-mail a rezervace byly úspěšně ověřeny.', 'success');
      showConfirmation(res.reservation);
    } catch (error) {
      showMessage(messageEl, error.message, 'error');
    }
  }
}

async function start() {
  await init();
  await checkUrlVerification();
}

start();
