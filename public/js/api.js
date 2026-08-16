// Shared fetch helper used by every page. The API is same-origin, so no base URL is needed.
const STAFF_TOKEN_KEY = 'reservation.staffToken';
const STAFF_USER_KEY = 'reservation.staffUser';

async function apiRequest(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = localStorage.getItem(STAFF_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = (json && json.message) || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = json;
    throw error;
  }

  return json;
}

function saveStaffSession(token, user) {
  localStorage.setItem(STAFF_TOKEN_KEY, token);
  localStorage.setItem(STAFF_USER_KEY, JSON.stringify(user));
}

function getStaffSession() {
  const token = localStorage.getItem(STAFF_TOKEN_KEY);
  const userRaw = localStorage.getItem(STAFF_USER_KEY);
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
}

function clearStaffSession() {
  localStorage.removeItem(STAFF_TOKEN_KEY);
  localStorage.removeItem(STAFF_USER_KEY);
}

function showMessage(el, text, type = 'success') {
  el.textContent = text;
  el.className = `message ${type}`;
  el.hidden = false;
}

function requireStaffSession(redirectTo = '/staff/login') {
  const session = getStaffSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}
