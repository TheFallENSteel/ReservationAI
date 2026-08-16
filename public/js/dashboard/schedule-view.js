// Rozvrh (schedule) view: visual timeline grid with drag/drop, hover details,
// click-to-add, and table merging.
window.ScheduleView = (function () {
  const PX_PER_MINUTE = 2.2;
  const ROW_LABEL_WIDTH = 150;
  const ROW_HEIGHT = 56;

  const state = {
    date: todayStr(),
    zoneFilter: '',
    capacityFilter: '',
    mergeMode: false,
    selected: new Set(), // selected reservation ids
    selectedTables: new Set() // selected bare table (resource) ids
  };

  const dateInput = document.getElementById('schedule-date');
  const zoneSelect = document.getElementById('schedule-zone-filter');
  const capacitySelect = document.getElementById('schedule-capacity-filter');
  const grid = document.getElementById('schedule-grid');
  const mergedList = document.getElementById('merged-blocks-list');
  const mergeBar = document.getElementById('schedule-merge-bar');
  const tooltip = document.getElementById('hover-tooltip');

  dateInput.value = state.date;

  function resourceName(id) {
    return Store.resources.find((r) => r.id === id)?.name ?? id;
  }

  function filteredResources() {
    return Store.resources.filter((r) => {
      if (state.zoneFilter && r.zone !== state.zoneFilter) return false;
      if (state.capacityFilter && r.capacity < Number(state.capacityFilter)) return false;
      return true;
    });
  }

  function dayReservations() {
    return Store.reservations.filter((r) => r.date === state.date && !r.blockId);
  }

  function timeScale() {
    const hours = openingHoursFor(Store.settings, state.date);
    if (!hours) return null;
    const openMinutes = minutesFromTime(hours.open);
    const closeMinutes = minutesFromTime(hours.close);
    return { openMinutes, closeMinutes, totalWidth: (closeMinutes - openMinutes) * PX_PER_MINUTE };
  }

  function buildHeader(scale) {
    const ticks = [];
    for (let m = scale.openMinutes; m < scale.closeMinutes; m += 60) {
      ticks.push(`<div class="schedule-tick" style="position:absolute;left:${(m - scale.openMinutes) * PX_PER_MINUTE}px;width:${60 * PX_PER_MINUTE}px;">${escapeHtml(timeFromMinutes(m))}</div>`);
    }
    return `
      <div class="schedule-header-row" style="height:32px;">
        <div class="row-label" style="width:${ROW_LABEL_WIDTH}px;flex:0 0 ${ROW_LABEL_WIDTH}px;">Stůl</div>
        <div style="position:relative;width:${scale.totalWidth}px;">${ticks.join('')}</div>
      </div>`;
  }

  function reservationTooltipHtml(r) {
    return `
      <strong>${escapeHtml(r.guestName)}</strong>
      ${r.phone ? `📞 ${escapeHtml(r.phone)}<br/>` : ''}
      ${r.notes ? `📝 ${escapeHtml(r.notes)}` : '<em>Bez poznámky</em>'}`;
  }

  function buildRow(resource, scale) {
    const reservations = dayReservations().filter((r) => r.resourceId === resource.id);

    const blocks = reservations
      .map((r) => {
        const start = minutesFromTime(r.startTime);
        const end = minutesFromTime(r.endTime);
        const left = Math.max(0, (start - scale.openMinutes) * PX_PER_MINUTE);
        const width = Math.max(16, (end - start) * PX_PER_MINUTE);
        const selectedClass = state.selected.has(r.id) ? ' selected' : '';
        return `
          <div class="reservation-block status-${escapeHtml(r.status)}${selectedClass}"
               draggable="true"
               data-id="${escapeHtml(r.id)}"
               style="left:${left}px;width:${width}px;">
            ${escapeHtml(r.startTime)} ${escapeHtml(r.guestName)} (${escapeHtml(String(r.guestCount))})
          </div>`;
      })
      .join('');

    const rowClasses = ['schedule-row'];
    if (state.mergeMode) rowClasses.push('table-selectable');
    if (state.selectedTables.has(resource.id)) rowClasses.push('table-selected');

    return `
      <div class="${rowClasses.join(' ')}" style="height:${ROW_HEIGHT}px;" data-resource-id="${escapeHtml(resource.id)}">
        <div class="row-label" style="width:${ROW_LABEL_WIDTH}px;flex:0 0 ${ROW_LABEL_WIDTH}px;">
          <span>${escapeHtml(resource.name)}</span>
          <span class="zone">${escapeHtml(resource.zone)} · ${escapeHtml(String(resource.capacity))} os.</span>
        </div>
        <div class="row-track" style="width:${scale.totalWidth}px;" data-resource-id="${escapeHtml(resource.id)}">${blocks}</div>
      </div>`;
  }

  function buildNowIndicator(scale) {
    if (state.date !== todayStr()) return '';
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < scale.openMinutes || nowMinutes > scale.closeMinutes) return '';
    const left = ROW_LABEL_WIDTH + (nowMinutes - scale.openMinutes) * PX_PER_MINUTE;
    return `<div class="now-indicator" style="left:${left}px;"></div>`;
  }

  function render() {
    populateZoneSelect(zoneSelect, 'Všechny zóny');
    dateInput.value = state.date;

    const scale = timeScale();
    if (!scale) {
      grid.innerHTML = '<p class="schedule-closed-note">Restaurace má tento den zavřeno.</p>';
      renderMerged();
      return;
    }

    const resources = filteredResources();
    grid.innerHTML =
      buildHeader(scale) +
      `<div class="schedule-body">${resources.map((r) => buildRow(r, scale)).join('')}</div>` +
      buildNowIndicator(scale);

    attachRowEvents(scale);
    renderMerged();
  }

  function attachRowEvents(scale) {
    if (state.mergeMode) {
      grid.querySelectorAll('.schedule-row .row-label').forEach((label) => {
        const resourceId = label.closest('.schedule-row').dataset.resourceId;
        label.addEventListener('click', () => toggleTableSelection(resourceId));
      });
    }

    grid.querySelectorAll('.row-track').forEach((track) => {
      track.addEventListener('click', (event) => {
        if (event.target.closest('.reservation-block')) return;
        if (state.mergeMode) {
          toggleTableSelection(track.dataset.resourceId);
          return;
        }
        const rect = track.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const clickedMinute = scale.openMinutes + offsetX / PX_PER_MINUTE;
        const slot = Number(Store.settings.slotMinutes) || 30;
        const startMinute = Math.min(scale.closeMinutes - slot, Math.max(scale.openMinutes, roundToStep(clickedMinute, slot)));
        const duration = Number(Store.settings.minimumReservationMinutes) || 60;
        openAddModal(track.dataset.resourceId, timeFromMinutes(startMinute), timeFromMinutes(startMinute + duration));
      });

      track.addEventListener('dragover', (event) => event.preventDefault());
      track.addEventListener('drop', (event) => {
        event.preventDefault();
        const id = event.dataTransfer.getData('text/plain');
        const reservation = Store.reservations.find((r) => r.id === id);
        if (!reservation) return;

        const rect = track.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const slot = Number(Store.settings.slotMinutes) || 30;
        const duration = minutesFromTime(reservation.endTime) - minutesFromTime(reservation.startTime);
        const startMinute = Math.max(scale.openMinutes, roundToStep(scale.openMinutes + offsetX / PX_PER_MINUTE, slot));
        const endMinute = Math.min(scale.closeMinutes, startMinute + duration);

        moveReservation(reservation.id, track.dataset.resourceId, timeFromMinutes(startMinute), timeFromMinutes(endMinute));
      });
    });

    grid.querySelectorAll('.reservation-block').forEach((block) => {
      const id = block.dataset.id;
      const reservation = Store.reservations.find((r) => r.id === id);
      if (!reservation) return;

      block.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.mergeMode) {
          toggleSelection(id, block);
          return;
        }
        window.ReservationsView.openReservationModal({ mode: 'edit', reservation, onSaved: refreshAndRender });
      });

      block.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', id);
        block.classList.add('dragging');
      });
      block.addEventListener('dragend', () => block.classList.remove('dragging'));

      block.addEventListener('mouseenter', (event) => {
        tooltip.innerHTML = reservationTooltipHtml(reservation);
        tooltip.style.display = 'block';
        positionTooltip(event);
      });
      block.addEventListener('mousemove', positionTooltip);
      block.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });
  }

  function positionTooltip(event) {
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top = `${event.clientY + 14}px`;
  }

  async function moveReservation(id, resourceId, startTime, endTime) {
    try {
      await apiRequest(`/api/staff/reservation/${id}`, {
        method: 'PATCH',
        auth: true,
        body: { resourceId, startTime, endTime }
      });
      await refreshAndRender();
      toast('Rezervace přesunuta.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openAddModal(resourceId, startTime, endTime) {
    window.ReservationsView.openReservationModal({
      mode: 'create',
      prefill: { resourceId, date: state.date, startTime, endTime },
      onSaved: refreshAndRender
    });
  }

  // --- Merge mode --------------------------------------------------------------
  // Two ways to merge: pick 2+ existing reservations directly, or pick 2+ bare
  // tables (rows) to pre-merge them before a reservation is made.

  function toggleSelection(id, blockEl) {
    if (state.selected.has(id)) {
      state.selected.delete(id);
      blockEl.classList.remove('selected');
    } else {
      state.selected.add(id);
      blockEl.classList.add('selected');
    }
  }

  function toggleTableSelection(resourceId) {
    if (state.selectedTables.has(resourceId)) {
      state.selectedTables.delete(resourceId);
    } else {
      state.selectedTables.add(resourceId);
    }
    render();
  }

  document.getElementById('schedule-merge-toggle').addEventListener('click', () => {
    state.mergeMode = !state.mergeMode;
    state.selected.clear();
    state.selectedTables.clear();
    mergeBar.hidden = !state.mergeMode;
    render();
  });

  document.getElementById('schedule-merge-cancel').addEventListener('click', () => {
    state.mergeMode = false;
    state.selected.clear();
    state.selectedTables.clear();
    mergeBar.hidden = true;
    render();
  });

  document.getElementById('schedule-merge-confirm').addEventListener('click', async () => {
    if (state.selected.size >= 2) {
      await mergeSelectedReservations();
      return;
    }
    if (state.selectedTables.size >= 2) {
      openTableMergeModal();
      return;
    }
    toast('Vyberte alespoň dva stoly nebo dvě rezervace ke sloučení.', 'error');
  });

  async function mergeSelectedReservations() {
    const label = window.prompt('Název spojených stolů', 'Spojené stoly') ?? 'Spojené stoly';
    try {
      await apiRequest('/api/staff/reservation/merge', {
        method: 'POST',
        auth: true,
        body: { reservationIds: [...state.selected], label }
      });
      exitMergeMode();
      await refreshAndRender();
      toast('Stoly byly spojeny.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openTableMergeModal() {
    const scale = timeScale();
    const openTime = scale ? timeFromMinutes(scale.openMinutes) : '12:00';
    const closeTime = scale ? timeFromMinutes(scale.closeMinutes) : '22:00';
    const stepTimes = scale
      ? (() => {
          const list = [];
          for (let m = scale.openMinutes; m <= scale.closeMinutes; m += Number(Store.settings.slotMinutes) || 30) list.push(timeFromMinutes(m));
          return list;
        })()
      : allDayTimes(30);

    const tableNames = [...state.selectedTables].map(resourceName).map(escapeHtml).join(', ');
    const body = openModal('Sloučit stoly', `
      <p class="muted">Spojované stoly: <strong>${tableNames}</strong></p>
      <form id="table-merge-form">
        <div class="field-row">
          <div>
            <label for="tm-label">Název</label>
            <input type="text" id="tm-label" value="Spojené stoly" required />
          </div>
          <div>
            <label for="tm-start">Od</label>
            ${timeSelectHtml('tm-start', stepTimes, openTime, { label: 'Čas od' })}
          </div>
          <div>
            <label for="tm-end">Do</label>
            ${timeSelectHtml('tm-end', stepTimes, closeTime, { label: 'Čas do' })}
          </div>
        </div>
        <div class="actions">
          <button type="submit">Vytvořit spojení</button>
        </div>
      </form>`);

    body.querySelector('#table-merge-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await apiRequest('/api/staff/table-blocks', {
          method: 'POST',
          auth: true,
          body: {
            label: document.getElementById('tm-label').value,
            tableIds: [...state.selectedTables],
            date: state.date,
            startTime: document.getElementById('tm-start').value,
            endTime: document.getElementById('tm-end').value
          }
        });
        closeModal();
        exitMergeMode();
        await refreshAndRender();
        toast('Stoly byly spojeny.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function exitMergeMode() {
    state.mergeMode = false;
    state.selected.clear();
    state.selectedTables.clear();
    mergeBar.hidden = true;
  }

  function renderMerged() {
    const blocks = Store.tableBlocks.filter((b) => b.date === state.date);
    if (blocks.length === 0) {
      mergedList.innerHTML = 'Žádné spojené stoly pro tento den.';
      mergedList.className = 'muted';
      return;
    }

    mergedList.className = '';
    mergedList.innerHTML = blocks
      .map((block) => {
        const linked = Store.reservations.filter((r) => r.blockId === block.id);
        return `
          <div class="merge-card">
            <h4>${escapeHtml(block.label)}</h4>
            <div class="merge-meta">
              Stoly: ${block.tableIds.map(resourceName).map(escapeHtml).join(', ')} ·
              ${escapeHtml(block.startTime)}–${escapeHtml(block.endTime)}
            </div>
            <ul class="top-list">
              ${linked.map((r) => `<li><span>${escapeHtml(r.guestName)} (${escapeHtml(String(r.guestCount))})</span><span>${escapeHtml(r.startTime)}</span></li>`).join('') || '<li class="muted">Zatím bez rezervace.</li>'}
            </ul>
            <button type="button" class="secondary" data-split-block="${escapeHtml(block.id)}" data-has-reservations="${linked.length > 0}">Rozpojit</button>
          </div>`;
      })
      .join('');

    mergedList.querySelectorAll('[data-split-block]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          // Blocks with linked reservations must go through /split (it also frees
          // each reservation's blockId); bare table-only blocks have nothing to
          // unlink, so they're removed directly.
          if (btn.dataset.hasReservations === 'true') {
            await apiRequest('/api/staff/reservation/split', {
              method: 'POST',
              auth: true,
              body: { blockId: btn.dataset.splitBlock }
            });
          } else {
            await apiRequest(`/api/staff/table-blocks/${btn.dataset.splitBlock}`, { method: 'DELETE', auth: true });
          }
          await refreshAndRender();
          toast('Stoly byly rozpojeny.');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  async function refreshAndRender() {
    await refreshCoreData();
    render();
  }

  document.getElementById('schedule-prev-day').addEventListener('click', () => {
    state.date = addDaysStr(state.date, -1);
    render();
  });
  document.getElementById('schedule-next-day').addEventListener('click', () => {
    state.date = addDaysStr(state.date, 1);
    render();
  });
  document.getElementById('schedule-today').addEventListener('click', () => {
    state.date = todayStr();
    render();
  });
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value || todayStr();
    render();
  });
  zoneSelect.addEventListener('change', () => {
    state.zoneFilter = zoneSelect.value;
    render();
  });
  capacitySelect.addEventListener('change', () => {
    state.capacityFilter = capacitySelect.value;
    render();
  });
  document.getElementById('schedule-add').addEventListener('click', () => {
    const defaultResource = filteredResources()[0]?.id ?? Store.resources[0]?.id;
    window.ReservationsView.openReservationModal({
      mode: 'create',
      prefill: { resourceId: defaultResource, date: state.date },
      onSaved: refreshAndRender
    });
  });

  // Keep the "now" indicator fresh without a full re-render.
  setInterval(() => {
    if (document.getElementById('view-schedule').classList.contains('active')) render();
  }, 60000);

  return { render };
})();
