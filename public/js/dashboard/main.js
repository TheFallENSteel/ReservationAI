// Bootstraps the dashboard: session check, shared data store, nav switching.

const session = requireStaffSession();
if (session) {
  document.getElementById('welcome').textContent = `${session.user.name} (${session.user.role})`;
}

const messageEl = document.getElementById('message');

// Shared in-memory store populated from the API and read by every view module.
const Store = {
  reservations: [],
  resources: [],
  tableBlocks: [],
  settings: {},
  zoneNames: [] // distinct zone names derived from resources, available to every role
};

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

// --- Navigation --------------------------------------------------------------

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  schedule: 'Rozvrh',
  reservations: 'Přehled rezervací',
  archive: 'Archiv',
  tables: 'Správa stolů',
  users: 'Uživatelé',
  settings: 'Nastavení',
  logs: 'Protokoly'
};

const VIEW_INIT = {
  dashboard: () => window.DashboardView.render(),
  schedule: () => window.ScheduleView.render(),
  reservations: () => window.ReservationsView.renderActive(),
  archive: () => window.ReservationsView.renderArchive(),
  tables: () => window.TablesView.render(),
  users: () => window.AdminView.renderUsers(),
  settings: () => window.AdminView.renderSettings(),
  logs: () => window.AdminView.renderLogs()
};

let viewToken = 0;

function showView(name) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  const view = document.getElementById(`view-${name}`);
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (!view || !nav) return;

  view.classList.add('active');
  nav.classList.add('active');
  document.getElementById('view-title').textContent = VIEW_TITLES[name] ?? name;

  // Clear any stale error/success banner left over from the previous view.
  messageEl.hidden = true;

  const token = ++viewToken;
  const init = VIEW_INIT[name];
  if (!init) return;

  Promise.resolve()
    .then(() => init())
    .catch((error) => {
      if (token !== viewToken) return; // user already navigated away; ignore stale errors
      if (error.status === 401) {
        clearStaffSession();
        window.location.href = '/staff/login';
        return;
      }
      toast(error.message, 'error');
    });
}

document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

window.gotoView = showView;
window.refreshCoreData = refreshCoreData;

// --- Shared data loading -------------------------------------------------------

async function refreshCoreData() {
  const [reservationsRes, resourcesRes, blocksRes] = await Promise.all([
    apiRequest('/api/staff/reservation', { auth: true }),
    apiRequest('/api/staff/resources/overview', { auth: true }),
    apiRequest('/api/staff/table-blocks', { auth: true })
  ]);

  Store.reservations = reservationsRes.reservations;
  Store.tableBlocks = blocksRes.blocks;
  Store.resources = resourcesRes.resources.map((r) => ({
    ...r,
    status: computeClientResourceStatus(r, Store.reservations)
  }));
  Store.zoneNames = [...new Set(Store.resources.map((r) => r.zone))].sort();

  try {
    const settingsRes = await apiRequest('/api/user/settings');
    Store.settings = settingsRes.settings;
  } catch {
    Store.settings = {};
  }
}

function populateZoneSelect(select, includeBlank = 'Vše') {
  const current = select.value;
  select.innerHTML =
    `<option value="">${escapeHtml(includeBlank)}</option>` +
    Store.zoneNames.map((z) => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join('');
  if (current) select.value = current;
}

(async function init() {
  try {
    await refreshCoreData();

    if (session.user.role === 'admin') {
      document.getElementById('admin-nav-group').hidden = false;
    }

    showView('dashboard');
  } catch (error) {
    if (error.status === 401) {
      clearStaffSession();
      window.location.href = '/staff/login';
      return;
    }
    toast(error.message, 'error');
  }
})();
