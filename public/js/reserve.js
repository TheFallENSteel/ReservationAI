const resourceSelect = document.getElementById('resourceId');
const form = document.getElementById('reserve-form');
const messageEl = document.getElementById('message');
const confirmationEl = document.getElementById('confirmation');

async function loadResources() {
  try {
    const { resources } = await apiRequest('/api/user/reservation/resources');
    resourceSelect.innerHTML = resources
      .map((resource) => `<option value="${resource.id}">${resource.name} - ${resource.zone} (up to ${resource.maxGuests} guests)</option>`)
      .join('');
  } catch (error) {
    showMessage(messageEl, `Could not load tables: ${error.message}`, 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageEl.hidden = true;
  confirmationEl.hidden = true;

  const resourceId = resourceSelect.value;
  const payload = {
    date: document.getElementById('date').value,
    startTime: document.getElementById('startTime').value,
    endTime: document.getElementById('endTime').value,
    guestCount: Number(document.getElementById('guestCount').value),
    guestName: document.getElementById('guestName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    notes: document.getElementById('notes').value || undefined
  };

  try {
    const { reservation } = await apiRequest(`/api/user/reserve/${resourceId}`, { method: 'POST', body: payload });
    showMessage(messageEl, 'Reservation requested successfully.', 'success');
    document.getElementById('confirm-reservation-id').textContent = reservation.id;
    document.getElementById('confirm-resource-id').textContent = reservation.resourceId;
    document.getElementById('manage-link').href = `/reserve/manage?resource=${reservation.resourceId}&reservation=${reservation.id}`;
    confirmationEl.hidden = false;
    form.reset();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

loadResources();
