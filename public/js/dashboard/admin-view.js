// Administrace (admin-only): users, general settings, opening hours, logs.
window.AdminView = (function () {
  const GENERAL_SETTING_LABELS = {
    slotMinutes: 'Délka rezervačního slotu (min)',
    cleanupMinutes: 'Doba úklidu stolu (min)',
    minimumReservationMinutes: 'Min. délka rezervace (min)',
    maximumReservationMinutes: 'Max. délka rezervace (min)',
    minimumLeadMinutes: 'Min. čas před rezervací (min)',
    archiveRetentionDays: 'Doba uchování archivu (dní)',
    dashboardPreviewDays: 'Délka náhledu z dashboardu (dní)',
    forecastDays: 'Počet dní s přehledem obsazenosti'
  };

  const WEEKDAY_LABELS = {
    monday: 'Pondělí',
    tuesday: 'Úterý',
    wednesday: 'Středa',
    thursday: 'Čtvrtek',
    friday: 'Pátek',
    saturday: 'Sobota',
    sunday: 'Neděle'
  };

  let settings = {};
  let specialHoursDraft = [];

  // --- Users -----------------------------------------------------------------

  async function renderUsers() {
    const { users } = await apiRequest('/api/admin/user', { auth: true });
    document.getElementById('users-body').innerHTML = users
      .map(
        (u) => `
          <tr>
            <td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td>
            <td><button type="button" class="danger" data-user-id="${escapeHtml(u.id)}">Smazat</button></td>
          </tr>`
      )
      .join('');

    document.querySelectorAll('#users-body [data-user-id]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Smazat tohoto uživatele?')) return;
        try {
          await apiRequest(`/api/admin/user/${btn.dataset.userId}`, { method: 'DELETE', auth: true });
          await renderUsers();
          toast('Uživatel byl smazán.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
  }

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
      await renderUsers();
      toast('Uživatel byl vytvořen.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // --- Settings ----------------------------------------------------------------

  function renderGeneralSettings() {
    document.getElementById('settings-body').innerHTML = Object.entries(GENERAL_SETTING_LABELS)
      .map(
        ([key, label]) => `
        <div class="setting-row">
          <label for="setting-${key}">${escapeHtml(label)}</label>
          <input data-setting="${key}" id="setting-${key}" type="number" value="${escapeHtml(String(settings[key] ?? ''))}" />
        </div>`
      )
      .join('');

    document.querySelectorAll('#settings-body [data-setting]').forEach((input) =>
      input.addEventListener('change', async () => {
        try {
          await apiRequest(`/api/admin/settings/${input.dataset.setting}`, {
            method: 'PATCH',
            auth: true,
            body: { value: Number(input.value) }
          });
          settings[input.dataset.setting] = Number(input.value);
          if (input.dataset.setting === 'slotMinutes') {
            renderOpeningHours();
            renderSpecialHours();
          }
          toast('Nastavení uloženo.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
  }

  function timeOptionsFor(value) {
    const step = Number(settings.slotMinutes) || 30;
    const times = allDayTimes(step);
    if (value && !times.includes(value)) times.push(value);
    return times.sort();
  }

  function renderOpeningHours() {
    const hours = settings.openingHours ?? {};
    document.getElementById('opening-hours-body').innerHTML = Object.keys(WEEKDAY_LABELS)
      .map((day) => {
        const entry = hours[day] ?? { open: '', close: '' };
        return `
          <div class="day-name">${escapeHtml(WEEKDAY_LABELS[day])}</div>
          ${timeSelectGroupHtml(`oh-open-${day}`, timeOptionsFor(entry.open), entry.open, { dataAttr: `data-oh-open="${day}"` })}
          ${timeSelectGroupHtml(`oh-close-${day}`, timeOptionsFor(entry.close), entry.close, { dataAttr: `data-oh-close="${day}"` })}`;
      })
      .join('');
  }

  document.getElementById('save-opening-hours').addEventListener('click', async () => {
    const openingHours = {};
    Object.keys(WEEKDAY_LABELS).forEach((day) => {
      const open = document.querySelector(`[data-oh-open="${day}"]`).value;
      const close = document.querySelector(`[data-oh-close="${day}"]`).value;
      if (open && close) openingHours[day] = { open, close };
    });
    try {
      await apiRequest('/api/admin/settings/openingHours', { method: 'PATCH', auth: true, body: { value: openingHours } });
      settings.openingHours = openingHours;
      toast('Otevírací doba byla uložena.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  function renderSpecialHours() {
    document.getElementById('special-hours-body').innerHTML = specialHoursDraft.length
      ? specialHoursDraft
          .map(
            (entry, index) => `
            <div class="special-hours-row">
              <input type="date" data-sh-date="${index}" value="${escapeHtml(entry.date ?? '')}" />
              ${timeSelectGroupHtml(`sh-open-${index}`, timeOptionsFor(entry.open), entry.open, { dataAttr: `data-sh-open="${index}"`, disabled: entry.closed })}
              ${timeSelectGroupHtml(`sh-close-${index}`, timeOptionsFor(entry.close), entry.close, { dataAttr: `data-sh-close="${index}"`, disabled: entry.closed })}
              <label style="display:flex;align-items:center;gap:0.3rem;margin:0;">
                <input type="checkbox" data-sh-closed="${index}" ${entry.closed ? 'checked' : ''} /> Zavřeno
              </label>
              <button type="button" class="danger" data-sh-remove="${index}">Odebrat</button>
            </div>`
          )
          .join('')
      : '<p class="muted">Žádné výjimky. Přidejte den (např. svátek) s vlastní otevírací dobou nebo úplným zavřením.</p>';

    document.querySelectorAll('[data-sh-remove]').forEach((btn) =>
      btn.addEventListener('click', () => {
        specialHoursDraft.splice(Number(btn.dataset.shRemove), 1);
        renderSpecialHours();
      })
    );
    document.querySelectorAll('[data-sh-closed]').forEach((checkbox) =>
      checkbox.addEventListener('change', () => {
        specialHoursDraft[Number(checkbox.dataset.shClosed)].closed = checkbox.checked;
        renderSpecialHours();
      })
    );
  }

  document.getElementById('add-special-hour').addEventListener('click', () => {
    specialHoursDraft.push({ date: todayStr(), open: '12:00', close: '22:00', closed: false });
    renderSpecialHours();
  });

  document.getElementById('save-special-hours').addEventListener('click', async () => {
    const collected = specialHoursDraft.map((_, index) => ({
      date: document.querySelector(`[data-sh-date="${index}"]`).value,
      open: document.querySelector(`[data-sh-open="${index}"]`).value,
      close: document.querySelector(`[data-sh-close="${index}"]`).value,
      closed: document.querySelector(`[data-sh-closed="${index}"]`).checked
    }));
    try {
      await apiRequest('/api/admin/settings/specialHours', { method: 'PATCH', auth: true, body: { value: collected } });
      specialHoursDraft = collected;
      settings.specialHours = collected;
      toast('Výjimky byly uloženy.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // --- Settings Sub-Tabs ----------------------------------------------------
  document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-settings-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.settingsTab;
      document.getElementById('settings-panel-general').hidden = target !== 'general';
      document.getElementById('settings-panel-hours').hidden = target !== 'hours';
      document.getElementById('settings-panel-emails').hidden = target !== 'emails';
    });
  });

  function renderEmailTemplates() {
    const templates = settings.emailTemplates ?? {};
    const tplConfirm = document.getElementById('email-tpl-confirmation');
    const tplChange = document.getElementById('email-tpl-change');
    const tpl2fa = document.getElementById('email-tpl-verification2fa');
    const tplCancel = document.getElementById('email-tpl-cancellation');

    if (tplConfirm) tplConfirm.value = templates.confirmation ?? settings.emailTemplate ?? '';
    if (tplChange) tplChange.value = templates.change ?? '';
    if (tpl2fa) tpl2fa.value = templates.verification2fa ?? '';
    if (tplCancel) tplCancel.value = templates.cancellation ?? '';
  }

  document.getElementById('save-all-email-templates')?.addEventListener('click', async () => {
    const emailTemplates = {
      confirmation: document.getElementById('email-tpl-confirmation')?.value ?? '',
      change: document.getElementById('email-tpl-change')?.value ?? '',
      verification2fa: document.getElementById('email-tpl-verification2fa')?.value ?? '',
      cancellation: document.getElementById('email-tpl-cancellation')?.value ?? ''
    };

    try {
      await apiRequest('/api/admin/settings/emailTemplates', { method: 'PATCH', auth: true, body: { value: emailTemplates } });
      await apiRequest('/api/admin/settings/emailTemplate', { method: 'PATCH', auth: true, body: { value: emailTemplates.confirmation } });
      settings.emailTemplates = emailTemplates;
      settings.emailTemplate = emailTemplates.confirmation;
      toast('E-mailové šablony byly úspěšně uloženy.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  async function renderSettings() {
    const { settings: fetched } = await apiRequest('/api/admin/settings', { auth: true });
    settings = fetched;
    specialHoursDraft = Array.isArray(settings.specialHours) ? [...settings.specialHours] : [];
    renderGeneralSettings();
    renderOpeningHours();
    renderSpecialHours();
    renderEmailTemplates();
  }

  // --- Logs --------------------------------------------------------------------

  async function renderLogs() {
    const { logs } = await apiRequest('/api/admin/logs', { auth: true });
    document.getElementById('logs-body').innerHTML = logs
      .map((l) => `<tr><td>${escapeHtml(new Date(l.timestamp).toLocaleString('cs-CZ'))}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.actor)}</td></tr>`)
      .join('');
  }

  return { renderUsers, renderSettings, renderLogs };
})();
