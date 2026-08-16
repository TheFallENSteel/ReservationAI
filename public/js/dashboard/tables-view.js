// Správa stolů (table management) admin view: tables + zones tabs.
window.TablesView = (function () {
  let zones = [];
  const filters = { zone: '', capacity: '', status: '' };

  document.querySelectorAll('[data-tables-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-tables-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tables-panel-tables').hidden = tab.dataset.tablesTab !== 'tables';
      document.getElementById('tables-panel-zones').hidden = tab.dataset.tablesTab !== 'zones';
    });
  });

  async function loadZones() {
    const { zones: fetched } = await apiRequest('/api/admin/resource/zone', { auth: true });
    zones = fetched;
  }

  function filteredTables() {
    return Store.resources.filter((r) => {
      if (filters.zone && r.zone !== filters.zone) return false;
      if (filters.capacity && r.capacity < Number(filters.capacity)) return false;
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
  }

  function statusToggleLabel(status) {
    return status === 'disabled' ? 'Aktivovat' : 'Deaktivovat';
  }

  function renderTables() {
    populateZoneSelect(document.getElementById('table-zone-filter'));
    const list = filteredTables();
    document.getElementById('tables-body').innerHTML = list.length
      ? list
          .map(
            (r) => `
            <tr>
              <td>${escapeHtml(r.id)}</td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.zone)}</td>
              <td>${escapeHtml(String(r.minGuests))}–${escapeHtml(String(r.maxGuests))}</td>
              <td>${statusBadgeHtml(r.status)}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="secondary" data-edit-table="${escapeHtml(r.id)}">Upravit</button>
                  <button type="button" class="secondary" data-toggle-table="${escapeHtml(r.id)}">${statusToggleLabel(r.status)}</button>
                  <button type="button" class="danger" data-delete-table="${escapeHtml(r.id)}">Smazat</button>
                </div>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="muted">Žádné stoly neodpovídají filtru.</td></tr>';

    wireTableActions();
  }

  function wireTableActions() {
    document.querySelectorAll('[data-edit-table]').forEach((btn) =>
      btn.addEventListener('click', () => openTableModal(Store.resources.find((r) => r.id === btn.dataset.editTable)))
    );
    document.querySelectorAll('[data-toggle-table]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const resource = Store.resources.find((r) => r.id === btn.dataset.toggleTable);
        const nextStatus = resource.status === 'disabled' ? 'available' : 'disabled';
        try {
          await apiRequest(`/api/admin/resource/${resource.id}`, { method: 'PATCH', auth: true, body: { status: nextStatus } });
          await refreshAndRender();
          toast('Stav stolu byl změněn.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
    document.querySelectorAll('[data-delete-table]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Opravdu smazat tento stůl?')) return;
        try {
          await apiRequest(`/api/admin/resource?id=${encodeURIComponent(btn.dataset.deleteTable)}`, { method: 'DELETE', auth: true });
          await refreshAndRender();
          toast('Stůl byl smazán.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
  }

  function openTableModal(resource) {
    const isEdit = Boolean(resource);
    const values = resource ?? { id: '', name: '', capacity: 2, zone: zones[0]?.name ?? '', status: 'available', minGuests: 1, maxGuests: 2 };

    const body = openModal(isEdit ? 'Upravit stůl' : 'Přidat stůl', `
      <form id="table-form">
        <div class="field-row">
          ${!isEdit ? `
          <div>
            <label for="tf-id">ID stolu (volitelné)</label>
            <input type="text" id="tf-id" placeholder="auto" />
          </div>` : ''}
          <div>
            <label for="tf-name">Název</label>
            <input type="text" id="tf-name" value="${escapeHtml(values.name)}" required />
          </div>
          <div>
            <label for="tf-zone">Zóna</label>
            <select id="tf-zone">
              ${zones.map((z) => `<option value="${escapeHtml(z.name)}" ${z.name === values.zone ? 'selected' : ''}>${escapeHtml(z.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div>
            <label for="tf-capacity">Kapacita</label>
            <input type="number" id="tf-capacity" min="1" value="${escapeHtml(String(values.capacity))}" required />
          </div>
          <div>
            <label for="tf-min">Min. hostů</label>
            <input type="number" id="tf-min" min="1" value="${escapeHtml(String(values.minGuests))}" required />
          </div>
          <div>
            <label for="tf-max">Max. hostů</label>
            <input type="number" id="tf-max" min="1" value="${escapeHtml(String(values.maxGuests))}" required />
          </div>
          <div>
            <label for="tf-status">Stav</label>
            <select id="tf-status">
              <option value="available" ${values.status === 'available' ? 'selected' : ''}>Volný</option>
              <option value="occupied" ${values.status === 'occupied' ? 'selected' : ''}>Obsazený</option>
              <option value="disabled" ${values.status === 'disabled' ? 'selected' : ''}>Deaktivovaný</option>
            </select>
          </div>
        </div>
        <div class="actions">
          <button type="submit">${isEdit ? 'Uložit změny' : 'Vytvořit stůl'}</button>
        </div>
      </form>`);

    body.querySelector('#table-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: document.getElementById('tf-name').value,
        zone: document.getElementById('tf-zone').value,
        capacity: Number(document.getElementById('tf-capacity').value),
        minGuests: Number(document.getElementById('tf-min').value),
        maxGuests: Number(document.getElementById('tf-max').value),
        status: document.getElementById('tf-status').value
      };
      try {
        if (isEdit) {
          await apiRequest(`/api/admin/resource/${resource.id}`, { method: 'PATCH', auth: true, body: payload });
        } else {
          const idField = document.getElementById('tf-id');
          if (idField.value.trim()) payload.id = idField.value.trim();
          await apiRequest('/api/admin/resource', { method: 'POST', auth: true, body: payload });
        }
        closeModal();
        await refreshAndRender();
        toast(isEdit ? 'Stůl upraven.' : 'Stůl vytvořen.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // --- Zones ---------------------------------------------------------------

  function renderZones() {
    document.getElementById('zones-body').innerHTML = zones
      .map((z) => `<tr><td>${escapeHtml(z.name)}</td><td><button type="button" class="danger" data-zone-id="${escapeHtml(z.id)}">Smazat</button></td></tr>`)
      .join('');

    document.querySelectorAll('#zones-body [data-zone-id]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await apiRequest(`/api/admin/resource/zone?id=${encodeURIComponent(btn.dataset.zoneId)}`, { method: 'DELETE', auth: true });
          await loadZones();
          renderZones();
          toast('Zóna byla smazána.');
        } catch (error) {
          toast(error.message, 'error');
        }
      })
    );
  }

  document.getElementById('new-zone-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiRequest('/api/admin/resource/zone', { method: 'POST', auth: true, body: { name: document.getElementById('zone-name').value } });
      event.target.reset();
      await loadZones();
      renderZones();
      toast('Zóna byla vytvořena.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  document.getElementById('table-add').addEventListener('click', () => openTableModal(null));
  document.getElementById('table-zone-filter').addEventListener('change', (e) => {
    filters.zone = e.target.value;
    renderTables();
  });
  document.getElementById('table-capacity-filter').addEventListener('input', debounce((e) => {
    filters.capacity = e.target.value;
    renderTables();
  }));
  document.getElementById('table-status-filter').addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderTables();
  });

  async function refreshAndRender() {
    await refreshCoreData();
    renderTables();
  }

  async function render() {
    await loadZones();
    renderTables();
    renderZones();
  }

  return { render };
})();
