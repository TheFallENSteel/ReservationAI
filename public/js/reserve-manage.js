const resourceInput = document.getElementById('resourceId');
const reservationInput = document.getElementById('reservationId');
const messageEl = document.getElementById('message');
const detailsEl = document.getElementById('details');
const statusBadge = document.getElementById('status-badge');

const params = new URLSearchParams(window.location.search);
if (params.get('resource')) resourceInput.value = params.get('resource');
if (params.get('reservation')) reservationInput.value = params.get('reservation');

function renderReservation(reservation) {
  document.getElementById('edit-date').value = reservation.date;
  document.getElementById('edit-start').value = reservation.startTime;
  document.getElementById('edit-end').value = reservation.endTime;
  document.getElementById('edit-guests').value = reservation.guestCount;
  statusBadge.textContent = reservation.status;
  statusBadge.className = `badge ${reservation.status}`;
  detailsEl.hidden = false;
}

async function loadReservation() {
  messageEl.hidden = true;
  detailsEl.hidden = true;
  const resourceId = resourceInput.value.trim();
  const reservationId = reservationInput.value.trim();
  if (!resourceId || !reservationId) {
    showMessage(messageEl, 'Enter both the table ID and reservation ID.', 'error');
    return;
  }

  try {
    const { reservation } = await apiRequest(`/api/user/reservation/${resourceId}/${reservationId}`);
    renderReservation(reservation);
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
}

document.getElementById('load-btn').addEventListener('click', loadReservation);

document.getElementById('save-btn').addEventListener('click', async () => {
  const resourceId = resourceInput.value.trim();
  const reservationId = reservationInput.value.trim();
  const payload = {
    date: document.getElementById('edit-date').value,
    startTime: document.getElementById('edit-start').value,
    endTime: document.getElementById('edit-end').value,
    guestCount: Number(document.getElementById('edit-guests').value)
  };

  try {
    const { updated } = await apiRequest(`/api/user/reserve/${resourceId}/${reservationId}`, {
      method: 'PATCH',
      body: payload
    });
    renderReservation(updated);
    showMessage(messageEl, 'Reservation updated.', 'success');
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('cancel-btn').addEventListener('click', async () => {
  const resourceId = resourceInput.value.trim();
  const reservationId = reservationInput.value.trim();
  if (!window.confirm('Cancel this reservation?')) return;

  try {
    const { deleted } = await apiRequest(`/api/user/reserve/${resourceId}/${reservationId}`, { method: 'DELETE' });
    renderReservation(deleted);
    showMessage(messageEl, 'Reservation cancelled.', 'success');
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

if (resourceInput.value && reservationInput.value) {
  loadReservation();
}
