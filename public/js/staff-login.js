const messageEl = document.getElementById('message');
const tabPassword = document.getElementById('tab-password');
const tabPin = document.getElementById('tab-pin');
const passwordForm = document.getElementById('password-form');
const pinForm = document.getElementById('pin-form');
const forgotLink = document.getElementById('forgot-link');
const forgotForm = document.getElementById('forgot-form');

tabPassword.addEventListener('click', () => {
  tabPassword.classList.add('active');
  tabPin.classList.remove('active');
  passwordForm.hidden = false;
  pinForm.hidden = true;
});

tabPin.addEventListener('click', () => {
  tabPin.classList.add('active');
  tabPassword.classList.remove('active');
  pinForm.hidden = false;
  passwordForm.hidden = true;
});

forgotLink.addEventListener('click', (event) => {
  event.preventDefault();
  forgotForm.hidden = !forgotForm.hidden;
});

async function login(body) {
  messageEl.hidden = true;
  try {
    const result = await apiRequest('/api/staff/login', { method: 'POST', body });
    saveStaffSession(result.token, result.user);
    window.location.href = '/staff/dashboard';
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
}

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  login({
    email: document.getElementById('email').value,
    password: document.getElementById('password').value
  });
});

pinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  login({ pin: document.getElementById('pin').value });
});

forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageEl.hidden = true;
  try {
    const result = await apiRequest('/api/staff/password/forgot', {
      method: 'POST',
      body: { email: document.getElementById('forgot-email').value }
    });
    showMessage(messageEl, result.message, 'success');
  } catch (error) {
    showMessage(messageEl, error.message, 'error');
  }
});
