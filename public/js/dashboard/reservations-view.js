// Přehled rezervací (active) + Archiv (elapsed) views, plus the shared
// create/edit reservation modal and the merge picker used by other views.
window.ReservationsView = (function () {
  const activeFilters = { search: '', date: '', zone: '', capacity: '', sort: 'desc' };
  const archiveFilters = { search: '', contact: '', date: '', zone: '', capacity: '', sort: 'desc' };

  function resourceName(id) {
    return Store.resources.find((r) => r.id === id)?.name ?? id;
  }

  function resourceOf(id) {
    return Store.resources.find((r) => r.id === id);
  }

  function matchesCommon(r, filters) {
    if (filters.date && r.date !== filters.date) return false;
    const resource = resourceOf(r.resourceId);
    if (filters.zone && resource?.zone !== filters.zone) return false;
    if (filters.capacity && (!resource || resource.capacity < Number(filters.capacity))) return false;
    return true;
  }

  function sortReservations(list, sort) {
    const factor = sort === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => factor * `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  }

  // --- Active overview -----------------------------------------------------

  function activeList() {
    let list = Store.reservations.filter((r) => !isReservationPast(r));
    list = list.filter((r) => matchesCommon(r, activeFilters));
    if (activeFilters.search) {
      const term = activeFilters.search.toLowerCase();
      list = list.filter((r) =>
        [r.guestName, r.email, r.phone, resourceName(r.resourceId)].some((v) => (v ?? '').toLowerCase().includes(term))
      );
    }
    return sortReservations(list, activeFilters.sort);
  }

  function rowHtml(r, { withActions }) {
    const actions = withActions
      ? `
        <div class="row-actions">
          <button type="button" class="secondary" data-edit="${escapeHtml(r.id)}">Upravit</button>
          <button type="button" class="secondary" data-merge="${escapeHtml(r.id)}">Sloučit</button>
          ${r.status !== 'cancelled' ? `<button type="button" class="danger" data-cancel="${escapeHtml(r.id)}">Zrušit</button>` : ''}
        </div>`
      : '';
    return `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.startTime)}–${escapeHtml(r.endTime)}</td>
        <td>${escapeHtml(r.guestName)}</td>
        <td>${escapeHtml(r.email)}<br/><span class="muted">${escapeHtml(r.phone)}</span></td>
        <td>${escapeHtml(resourceName(r.resourceId))}</td>
        <td>${escapeHtml(String(r.guestCount))}</td>
        <td>${statusBadgeHtml(r.status)}</td>
        ${withActions ? `<td>${actions}</td>` : ''}
      </tr>`;
  }

  function renderActive() {
    populateZoneSelect(document.getElementById('res-zone-filter'));
    const body = document.getElementById('reservations-body');
    const list = activeList();
    body.innerHTML = list.length
      ? list.map((r) => rowHtml(r, { withActions: true })).join('')
      : '<tr><td colspan="8" class="muted">Žádné rezervace neodpovídají filtru.</td></tr>';

    body.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const reservation = Store.reservations.find((r) => r.id === btn.dataset.edit);
        openReservationModal({ mode: 'edit', reservation, onSaved: refreshAndRenderActive });
      })
    );
    body.querySelectorAll('[data-cancel]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Zrušit tuto rezervaci?')) return;
        try {
          await apiRequest(`/api/staff/reservation/${btn.dataset.cancel}`, { method: 'DELETE', auth: true });
          await refreshAndRenderActive();
          toast('Rezervace zrušena.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
    body.querySelectorAll('[data-merge]').forEach((btn) =>
      btn.addEventListener('click', () => openMergePicker(btn.dataset.merge))
    );
  }

  async function refreshAndRenderActive() {
    await refreshCoreData();
    renderActive();
  }

  // --- Archive ---------------------------------------------------------------

  function archiveList() {
    let list = Store.reservations.filter((r) => isReservationPast(r));
    list = list.filter((r) => matchesCommon(r, archiveFilters));
    if (archiveFilters.search) {
      const term = archiveFilters.search.toLowerCase();
      list = list.filter((r) => [r.guestName, resourceName(r.resourceId)].some((v) => (v ?? '').toLowerCase().includes(term)));
    }
    if (archiveFilters.contact) {
      const term = archiveFilters.contact.toLowerCase();
      list = list.filter((r) => [r.email, r.phone].some((v) => (v ?? '').toLowerCase().includes(term)));
    }
    return sortReservations(list, archiveFilters.sort);
  }

  function renderArchive() {
    populateZoneSelect(document.getElementById('arch-zone-filter'));
    const body = document.getElementById('archive-body');
    const list = archiveList();
    body.innerHTML = list.length
      ? list.map((r) => rowHtml(r, { withActions: false })).join('')
      : '<tr><td colspan="7" class="muted">Žádné archivované rezervace neodpovídají filtru.</td></tr>';
  }

  // --- Shared create/edit modal ------------------------------------------------

  function openReservationModal({ mode, reservation, prefill, onSaved }) {
    const isEdit = mode === 'edit';
    const excludeId = reservation?.id;
    const defaultResourceId = reservation?.resourceId ?? prefill?.resourceId ?? Store.resources[0]?.id ?? '';

    // "Automatically choose nearest empty date": whenever a new reservation is
    // opened without an explicit start time, search forward for the first free slot.
    const nearest = !isEdit && !prefill?.startTime
      ? findNearestAvailableSlot(defaultResourceId, prefill?.date ?? todayStr())
      : null;

    const values = {
      resourceId: defaultResourceId,
      date: reservation?.date ?? prefill?.date ?? nearest?.date ?? todayStr(),
      startTime: reservation?.startTime ?? prefill?.startTime ?? nearest?.start ?? '',
      endTime: reservation?.endTime ?? prefill?.endTime ?? nearest?.end ?? '',
      guestCount: reservation?.guestCount ?? 2,
      guestName: reservation?.guestName ?? '',
      email: reservation?.email ?? '',
      phone: reservation?.phone ?? '',
      notes: reservation?.notes ?? '',
      status: reservation?.status ?? 'confirmed'
    };

    let starts = computeAvailableStarts({ resourceId: values.resourceId, date: values.date, excludeId });
    if (values.startTime && !starts.includes(values.startTime)) starts = [values.startTime, ...starts];
    let ends = computeAvailableEnds({ resourceId: values.resourceId, date: values.date, start: values.startTime, excludeId });
    if (values.endTime && !ends.includes(values.endTime)) ends = [values.endTime, ...ends];

    const body = openModal(isEdit ? 'Upravit rezervaci' : 'Nová rezervace', `
      <form id="reservation-form">
        <div class="field-row">
          <div>
            <label for="rf-resource">Stůl</label>
            <select id="rf-resource" required>
              ${Store.resources.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === values.resourceId ? 'selected' : ''}>${escapeHtml(r.name)} (${escapeHtml(r.zone)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="rf-date">Datum</label>
            <input type="date" id="rf-date" value="${escapeHtml(values.date)}" required />
          </div>
          <div>
            <label for="rf-start">Od</label>
            ${timeSelectHtml('rf-start', starts, values.startTime, { label: 'Čas od' })}
          </div>
          <div>
            <label for="rf-end">Do</label>
            ${timeSelectHtml('rf-end', ends, values.endTime, { label: 'Čas do' })}
          </div>
          <div>
            <label for="rf-guests">Osoby</label>
            <input type="number" id="rf-guests" min="1" value="${escapeHtml(String(values.guestCount))}" required />
          </div>
        </div>
        <p class="field-hint" id="rf-availability-hint"></p>
        <div class="field-row">
          <div>
            <label for="rf-name">Jméno hosta</label>
            <input type="text" id="rf-name" value="${escapeHtml(values.guestName)}" required />
          </div>
          <div>
            <label for="rf-email">E-mail</label>
            <input type="email" id="rf-email" value="${escapeHtml(values.email)}" />
          </div>
          <div>
            <label for="rf-phone">Telefon</label>
            <input type="tel" id="rf-phone" value="${escapeHtml(values.phone)}" />
          </div>
        </div>
        <label for="rf-notes">Poznámka</label>
        <textarea id="rf-notes" rows="2">${escapeHtml(values.notes)}</textarea>
        ${isEdit ? `
          <label for="rf-status">Stav</label>
          <select id="rf-status">
            ${['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']
              .map((s) => `<option value="${s}" ${s === values.status ? 'selected' : ''}>${escapeHtml(statusLabel(s))}</option>`)
              .join('')}
          </select>` : ''}
        <div class="actions">
          <button type="submit">${isEdit ? 'Uložit změny' : 'Vytvořit rezervaci'}</button>
        </div>
      </form>`);

    const resourceSelect = body.querySelector('#rf-resource');
    const dateInput = body.querySelector('#rf-date');
    const startSelect = body.querySelector('#rf-start');
    const endSelect = body.querySelector('#rf-end');
    const hint = body.querySelector('#rf-availability-hint');

    function refreshStarts(preferred) {
      const times = computeAvailableStarts({ resourceId: resourceSelect.value, date: dateInput.value, excludeId });
      renderTimeSelectOptions(startSelect, times, preferred ?? times[0] ?? '');
      hint.textContent = times.length === 0 ? 'Pro tento stůl a datum nejsou žádné volné termíny.' : '';
      refreshEnds();
    }

    function refreshEnds() {
      const times = computeAvailableEnds({ resourceId: resourceSelect.value, date: dateInput.value, start: startSelect.value, excludeId });
      renderTimeSelectOptions(endSelect, times, times[0] ?? '');
    }

    resourceSelect.addEventListener('change', () => refreshStarts());
    dateInput.addEventListener('change', () => refreshStarts());
    startSelect.addEventListener('change', () => refreshEnds());

    body.querySelector('#reservation-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        resourceId: resourceSelect.value,
        date: dateInput.value,
        startTime: startSelect.value,
        endTime: endSelect.value,
        guestCount: Number(document.getElementById('rf-guests').value),
        guestName: document.getElementById('rf-name').value,
        email: document.getElementById('rf-email').value,
        phone: document.getElementById('rf-phone').value,
        notes: document.getElementById('rf-notes').value || undefined
      };
      if (!payload.startTime || !payload.endTime) {
        toast('Vyberte platný volný čas.', 'error');
        return;
      }
      if (isEdit) payload.status = document.getElementById('rf-status').value;

      try {
        if (isEdit) {
          await apiRequest(`/api/staff/reservation/${reservation.id}`, { method: 'PATCH', auth: true, body: payload });
        } else {
          await apiRequest('/api/staff/reservation', { method: 'POST', auth: true, body: payload });
        }
        closeModal();
        toast(isEdit ? 'Rezervace upravena.' : 'Rezervace vytvořena.');
        await onSaved?.();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // --- Merge picker ------------------------------------------------------------

  function openMergePicker(reservationId) {
    const reservation = Store.reservations.find((r) => r.id === reservationId);
    const candidates = Store.reservations.filter(
      (r) => r.id !== reservationId && r.date === reservation.date && !['cancelled', 'no_show'].includes(r.status) && !r.blockId
    );

    const body = openModal('Sloučit stoly', `
      <p class="muted">Vyberte rezervace, které chcete sloučit s rezervací hosta <strong>${escapeHtml(reservation.guestName)}</strong>.</p>
      <ul class="picker-list">
        ${candidates
          .map(
            (r) => `
            <li>
              <input type="checkbox" id="pick-${escapeHtml(r.id)}" value="${escapeHtml(r.id)}" />
              <label for="pick-${escapeHtml(r.id)}" style="margin:0;">${escapeHtml(r.startTime)} · ${escapeHtml(resourceName(r.resourceId))} · ${escapeHtml(r.guestName)} (${escapeHtml(String(r.guestCount))})</label>
            </li>`
          )
          .join('') || '<li class="muted">Žádné jiné rezervace tento den.</li>'}
      </ul>
      <div class="actions">
        <button type="button" id="merge-picker-confirm">Sloučit vybrané</button>
      </div>`);

    body.querySelector('#merge-picker-confirm').addEventListener('click', async () => {
      const selected = [...body.querySelectorAll('input[type=checkbox]:checked')].map((el) => el.value);
      if (selected.length === 0) {
        toast('Vyberte alespoň jednu další rezervaci.', 'error');
        return;
      }
      try {
        await apiRequest('/api/staff/reservation/merge', {
          method: 'POST',
          auth: true,
          body: { reservationIds: [reservationId, ...selected], label: 'Spojené stoly' }
        });
        closeModal();
        await refreshAndRenderActive();
        toast('Stoly byly spojeny.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // --- Filter wiring -------------------------------------------------------

  document.getElementById('res-search').addEventListener('input', debounce((e) => {
    activeFilters.search = e.target.value;
    renderActive();
  }));
  document.getElementById('res-date-filter').addEventListener('change', (e) => {
    activeFilters.date = e.target.value;
    renderActive();
  });
  document.getElementById('res-zone-filter').addEventListener('change', (e) => {
    activeFilters.zone = e.target.value;
    renderActive();
  });
  document.getElementById('res-capacity-filter').addEventListener('input', debounce((e) => {
    activeFilters.capacity = e.target.value;
    renderActive();
  }));
  document.getElementById('res-sort').addEventListener('change', (e) => {
    activeFilters.sort = e.target.value;
    renderActive();
  });
  document.getElementById('res-clear-filters').addEventListener('click', () => {
    Object.assign(activeFilters, { search: '', date: '', zone: '', capacity: '', sort: 'desc' });
    document.getElementById('res-search').value = '';
    document.getElementById('res-date-filter').value = '';
    document.getElementById('res-zone-filter').value = '';
    document.getElementById('res-capacity-filter').value = '';
    document.getElementById('res-sort').value = 'desc';
    renderActive();
  });
  document.getElementById('res-add').addEventListener('click', () => {
    openReservationModal({ mode: 'create', onSaved: refreshAndRenderActive });
  });

  document.getElementById('arch-search').addEventListener('input', debounce((e) => {
    archiveFilters.search = e.target.value;
    renderArchive();
  }));
  document.getElementById('arch-contact').addEventListener('input', debounce((e) => {
    archiveFilters.contact = e.target.value;
    renderArchive();
  }));
  document.getElementById('arch-date-filter').addEventListener('change', (e) => {
    archiveFilters.date = e.target.value;
    renderArchive();
  });
  document.getElementById('arch-zone-filter').addEventListener('change', (e) => {
    archiveFilters.zone = e.target.value;
    renderArchive();
  });
  document.getElementById('arch-capacity-filter').addEventListener('input', debounce((e) => {
    archiveFilters.capacity = e.target.value;
    renderArchive();
  }));
  document.getElementById('arch-sort').addEventListener('change', (e) => {
    archiveFilters.sort = e.target.value;
    renderArchive();
  });
  document.getElementById('arch-clear-filters').addEventListener('click', () => {
    Object.assign(archiveFilters, { search: '', contact: '', date: '', zone: '', capacity: '', sort: 'desc' });
    document.getElementById('arch-search').value = '';
    document.getElementById('arch-contact').value = '';
    document.getElementById('arch-date-filter').value = '';
    document.getElementById('arch-zone-filter').value = '';
    document.getElementById('arch-capacity-filter').value = '';
    document.getElementById('arch-sort').value = 'desc';
    renderArchive();
  });

  return { renderActive, renderArchive, openReservationModal };
})();
