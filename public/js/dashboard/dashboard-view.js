// Dashboard view: aggregate stats computed client-side from Store data.
window.DashboardView = (function () {
  function activeReservations() {
    return Store.reservations.filter((r) => !['cancelled', 'no_show'].includes(r.status));
  }

  function renderOccupancyNow() {
    const now = new Date();
    const today = todayStr();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const occupiedTableIds = new Set(
      activeReservations()
        .filter((r) => r.date === today && minutesFromTime(r.startTime) <= nowMinutes && nowMinutes <= minutesFromTime(r.endTime))
        .map((r) => r.resourceId)
    );

    const total = Store.resources.length || 1;
    const pct = (occupiedTableIds.size / total) * 100;

    document.getElementById('stat-occupancy-value').textContent = `${occupiedTableIds.size}/${Store.resources.length}`;
    renderProgressBar(document.getElementById('stat-occupancy-bar'), pct);
  }

  function renderCounts() {
    const today = todayStr();
    const todayCount = activeReservations().filter((r) => r.date === today).length;
    const activeCount = activeReservations().filter((r) => !isReservationPast(r)).length;

    document.getElementById('stat-today-count').textContent = String(todayCount);
    document.getElementById('stat-active-count').textContent = String(activeCount);
  }

  function renderSchedulePreview() {
    const today = todayStr();
    const items = activeReservations()
      .filter((r) => r.date === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, 6);

    const container = document.getElementById('schedule-preview');
    if (items.length === 0) {
      container.innerHTML = '<p class="muted">Dnes zatím nejsou žádné rezervace.</p>';
      return;
    }

    const resourceName = (id) => Store.resources.find((r) => r.id === id)?.name ?? id;

    container.innerHTML = `
      <table>
        <thead><tr><th>Čas</th><th>Stůl</th><th>Host</th><th>Osoby</th><th>Stav</th></tr></thead>
        <tbody>
          ${items
            .map(
              (r) => `
              <tr>
                <td>${escapeHtml(r.startTime)}–${escapeHtml(r.endTime)}</td>
                <td>${escapeHtml(resourceName(r.resourceId))}</td>
                <td>${escapeHtml(r.guestName)}</td>
                <td>${escapeHtml(String(r.guestCount))}</td>
                <td>${statusBadgeHtml(r.status)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  function renderUpcomingOccupancy() {
    const days = Number(Store.settings.forecastDays ?? Store.settings.dashboardPreviewDays ?? 3) || 3;
    const total = Store.resources.length || 1;
    const container = document.getElementById('upcoming-occupancy');
    container.innerHTML = '';

    for (let i = 0; i < days; i += 1) {
      const dateStr = addDaysStr(todayStr(), i);
      const occupied = new Set(
        activeReservations()
          .filter((r) => r.date === dateStr)
          .map((r) => r.resourceId)
      ).size;
      const pct = (occupied / total) * 100;

      const row = document.createElement('div');
      renderProgressBar(row, pct, `${occupied}/${Store.resources.length}`);
      const label = document.createElement('div');
      label.className = 'muted';
      label.style.fontSize = '0.8rem';
      label.textContent = i === 0 ? `Dnes (${formatDateHuman(dateStr)})` : formatDateHuman(dateStr);
      container.appendChild(label);
      container.appendChild(row);
    }
  }

  function renderTopGuestCounts() {
    const counts = new Map();
    for (const r of activeReservations()) {
      counts.set(r.guestCount, (counts.get(r.guestCount) ?? 0) + 1);
    }
    const top3 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const list = document.getElementById('top-guest-counts');
    if (top3.length === 0) {
      list.innerHTML = '<li>Zatím žádná data.</li>';
      return;
    }
    list.innerHTML = top3
      .map(([guestCount, count]) => `<li><span>${escapeHtml(String(guestCount))} osob</span><span>${escapeHtml(String(count))}×</span></li>`)
      .join('');
  }

  function renderVisitsChart() {
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dateStr = addDaysStr(todayStr(), -i);
      const count = activeReservations().filter((r) => r.date === dateStr).length;
      days.push({ label: dateStr.slice(5), value: count });
    }
    renderBarChart(document.getElementById('visits-chart'), days);
  }

  function render() {
    renderOccupancyNow();
    renderCounts();
    renderSchedulePreview();
    renderUpcomingOccupancy();
    renderTopGuestCounts();
    renderVisitsChart();
  }

  document.getElementById('goto-schedule').addEventListener('click', () => window.gotoView('schedule'));

  return { render };
})();
