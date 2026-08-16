const session = requireStaffSession();

if (session) {
  document.getElementById('welcome').textContent = `${session.user.name} (${session.user.role})`;
}

const messageEl = document.getElementById('message');

document.getElementById('logout-link').addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    await apiRequest('/api/staff/logout', { method: 'POST', auth: true });
  } catch {
    // ignore network errors on logout, still clear the local session
  }
  clearStaffSession();
  window.location.href = '/staff/login';
});

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

async function loadResources() {
  const { resources } = await apiRequest('/api/staff/resources/overview', { auth: true });

  const select = document.getElementById('resourceId');
  select.innerHTML = resources.map((r) => `<option value="${r.id}">${r.name} (${r.zone})</option>`).join('');

  const body = document.getElementById('resources-body');
  body.innerHTML = resources
    .map((r) => `<tr><td>${r.name}</td><td>${r.zone}</td><td>${r.capacity}</td><td>${statusBadge(r.status)}</td></tr>`)
    .join('');
}

async function loadReservations() {
  const { reservations } = await apiRequest('/api/staff/reservation', { auth: true });
  const body = document.getElementById('reservations-body');

  body.innerHTML = reservations
    .map(
      (r) => `
        <tr>
          <td>${r.date}</td>
          <td>${r.startTime}-${r.endTime}</td>
          <td>${r.resourceId}</td>
          <td>${r.guestName}</td>
          <td>${r.guestCount}</td>
          <td>${statusBadge(r.status)}</td>
          <td>
            <button type="button" class="secondary" data-action="checked_in" data-id="${r.id}">Check in</button>
            <button type="button" class="danger" data-action="cancel" data-id="${r.id}">Cancel</button>
          </td>
        </tr>`
    )
    .join('');
}

document.getElementById('reservations-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const { id, action } = button.dataset;

  try {
    if (action === 'cancel') {
      await apiRequest(`/api/staff/reservation/${id}`, { method: 'DELETE', auth: true });
    } else {
      await apiRequest(`/api/staff/reservation/${id}/status`, {
        method: 'PATCH',
        auth: true,
        body: { status: action }
      });
    }
    await loadReservations();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('new-reservation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    resourceId: document.getElementById('resourceId').value,
    date: document.getElementById('date').value,
    startTime: document.getElementById('startTime').value,
    endTime: document.getElementById('endTime').value,
    guestCount: Number(document.getElementById('guestCount').value),
    guestName: document.getElementById('guestName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value
  };

  try {
    await apiRequest('/api/staff/reservation', { method: 'POST', auth: true, body: payload });
    showMessage(messageEl, 'Reservation added.', 'success');
    event.target.reset();
    await loadReservations();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

// --- Admin panel -----------------------------------------------------------

function setupAdminTabs() {
  const tabs = document.querySelectorAll('.admin-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.admin-panel').forEach((panel) => {
        panel.hidden = panel.id !== `admin-${tab.dataset.tab}`;
      });
    });
  });
}

async function loadUsers() {
  const { users } = await apiRequest('/api/admin/user', { auth: true });
  document.getElementById('users-body').innerHTML = users
    .map(
      (u) => `
        <tr>
          <td>${u.name}</td><td>${u.email}</td><td>${u.role}</td>
          <td><button type="button" class="danger" data-user-id="${u.id}">Delete</button></td>
        </tr>`
    )
    .join('');
}

async function loadZones() {
  const { zones } = await apiRequest('/api/admin/resource/zone', { auth: true });
  document.getElementById('zones-body').innerHTML = zones
    .map((z) => `<tr><td>${z.name}</td><td><button type="button" class="danger" data-zone-id="${z.id}">Delete</button></td></tr>`)
    .join('');
}

async function loadSettings() {
  const { settings } = await apiRequest('/api/admin/settings', { auth: true });
  document.getElementById('settings-body').innerHTML = Object.entries(settings)
    .filter(([, value]) => typeof value !== 'object')
    .map(
      ([key, value]) => `
        <label for="setting-${key}">${key}</label>
        <input data-setting="${key}" id="setting-${key}" value="${value}" />`
    )
    .join('');
}

async function loadLogs() {
  const { logs } = await apiRequest('/api/admin/logs', { auth: true });
  document.getElementById('logs-body').innerHTML = logs
    .map((l) => `<tr><td>${new Date(l.timestamp).toLocaleString()}</td><td>${l.action}</td><td>${l.actor}</td></tr>`)
    .join('');
}

async function loadStats() {
  const { stats } = await apiRequest('/api/admin/stats/reservations', { auth: true });
  document.getElementById('stats-body').innerHTML = `
    <div class="card"><h3>Total</h3><p>${stats.totalReservations}</p></div>
    <div class="card"><h3>Confirmed</h3><p>${stats.confirmed}</p></div>
    <div class="card"><h3>Cancelled</h3><p>${stats.cancelled}</p></div>
    <div class="card"><h3>No-show</h3><p>${stats.noShow}</p></div>
  `;
}

document.getElementById('users-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-user-id]');
  if (!button) return;
  if (!window.confirm('Delete this user?')) return;
  try {
    await apiRequest(`/api/admin/user/${button.dataset.userId}`, { method: 'DELETE', auth: true });
    await loadUsers();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('zones-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-zone-id]');
  if (!button) return;
  try {
    await apiRequest(`/api/admin/resource/zone?id=${encodeURIComponent(button.dataset.zoneId)}`, {
      method: 'DELETE',
      auth: true
    });
    await loadZones();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('new-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    name: document.getElementById('user-name').value,
    email: document.getElementById('user-email').value,
    password: document.getElementById('user-password').value,
    role: document.getElementById('user-role').value
  };
  try {
    await apiRequest('/api/admin/user', { method: 'POST', auth: true, body: payload });
    event.target.reset();
    await loadUsers();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('new-zone-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiRequest('/api/admin/resource/zone', {
      method: 'POST',
      auth: true,
      body: { name: document.getElementById('zone-name').value }
    });
    event.target.reset();
    await loadZones();
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

document.getElementById('settings-body').addEventListener('change', async (event) => {
  const input = event.target.closest('input[data-setting]');
  if (!input) return;
  try {
    await apiRequest(`/api/admin/settings/${input.dataset.setting}`, {
      method: 'PATCH',
      auth: true,
      body: { value: Number.isNaN(Number(input.value)) ? input.value : Number(input.value) }
    });
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});

async function initAdminPanel() {
  if (session.user.role !== 'admin') return;
  document.getElementById('admin-section').hidden = false;
  setupAdminTabs();
  await Promise.all([loadUsers(), loadZones(), loadSettings(), loadLogs(), loadStats()]);
}

(async function init() {
  try {
    await Promise.all([loadResources(), loadReservations()]);
    await initAdminPanel();
  } catch (error) {
    if (error.status === 401) {
      clearStaffSession();
      window.location.href = '/staff/login';
      return;
    }
    showMessage(messageEl, error.message, 'error');
  }
})();
