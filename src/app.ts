import express, { type Request, type Response, type NextFunction } from 'express';

const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'reservation-system' });
});

app.get('/api/user/settings', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    settings: {
      slotMinutes: 30,
      minimumReservationMinutes: 60,
      maximumReservationMinutes: 180,
      minimumLeadMinutes: 30,
      archiveRetentionDays: 365,
      dashboardPreviewDays: 7,
      forecastDays: 3,
      openingHours: {
        monday: { open: '12:00', close: '23:00' }
      }
    }
  });
});

app.get('/api/user/reservation/resources', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    resources: [
      { id: 'table-1', name: 'Table 1', capacity: 2, zone: 'Garden' },
      { id: 'table-2', name: 'Table 2', capacity: 4, zone: 'Garden' },
      { id: 'table-3', name: 'Table 3', capacity: 6, zone: 'Indoor' }
    ]
  });
});

app.post('/api/user/reserve/:resource_id', (req: Request, res: Response) => {
  const { resource_id } = req.params;
  const payload = req.body ?? {};

  res.status(201).json({
    ok: true,
    reservation: {
      id: `res-${Date.now()}`,
      resourceId: resource_id,
      guestName: payload.guestName ?? 'Guest',
      email: payload.email ?? '',
      status: 'pending'
    }
  });
});

app.get('/api/user/reservation/:resource_id/:reservation_id', (req: Request, res: Response) => {
  const { resource_id, reservation_id } = req.params;

  res.json({
    ok: true,
    reservation: {
      id: reservation_id,
      resourceId: resource_id,
      guestName: 'Sample Guest',
      email: 'guest@example.com',
      phone: '+420111222333',
      guestCount: 2,
      date: '2026-08-18',
      startTime: '19:00',
      endTime: '20:30',
      status: 'confirmed'
    }
  });
});

app.patch('/api/user/reserve/:resource_id/:reservation_id', (req: Request, res: Response) => {
  const { resource_id, reservation_id } = req.params;

  res.json({
    ok: true,
    updated: {
      id: reservation_id,
      resourceId: resource_id,
      changes: req.body ?? {},
      status: 'updated'
    }
  });
});

app.delete('/api/user/reserve/:resource_id/:reservation_id', (req: Request, res: Response) => {
  const { resource_id, reservation_id } = req.params;

  res.json({
    ok: true,
    deleted: {
      id: reservation_id,
      resourceId: resource_id,
      status: 'cancelled'
    }
  });
});

app.post('/api/staff/register', (_req: Request, res: Response) => {
  res.status(201).json({ ok: true, user: { role: 'manager', status: 'created' } });
});

app.post('/api/staff/login', (_req: Request, res: Response) => {
  res.json({ ok: true, token: 'mock-staff-token', user: { id: 'staff-1', role: 'manager' } });
});

app.post('/api/staff/logout', (_req: Request, res: Response) => {
  res.json({ ok: true, loggedOut: true });
});

app.post('/api/staff/password/forgot', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Password reset link sent' });
});

app.post('/api/staff/password/reset', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Password reset successful' });
});

app.get('/api/staff/me', (_req: Request, res: Response) => {
  res.json({ ok: true, user: { id: 'staff-1', name: 'Manager Test', role: 'manager', email: 'manager@example.com' } });
});

app.patch('/api/staff/me', (_req: Request, res: Response) => {
  res.json({ ok: true, updated: true });
});

app.get('/api/staff/reservation', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    reservations: [
      { id: 'res-1001', guestName: 'Anna Novak', email: 'anna@example.com', phone: '+420123456789', table: 'Table 3', guestCount: 4, date: '2026-08-18', startTime: '18:30', endTime: '20:00' }
    ]
  });
});

app.post('/api/staff/reservation', (req: Request, res: Response) => {
  const payload = req.body ?? {};

  res.status(201).json({
    ok: true,
    reservation: {
      id: `res-${Date.now()}`,
      guestName: payload.guestName ?? 'New Guest',
      table: payload.table ?? 'Table 1',
      status: 'confirmed'
    }
  });
});

app.get('/api/staff/reservation/:reservation_id', (req: Request, res: Response) => {
  const { reservation_id } = req.params;

  res.json({
    ok: true,
    reservation: {
      id: reservation_id,
      guestName: 'Anna Novak',
      email: 'anna@example.com',
      phone: '+420123456789',
      guestCount: 4,
      status: 'confirmed'
    }
  });
});

app.patch('/api/staff/reservation/:reservation_id', (req: Request, res: Response) => {
  const { reservation_id } = req.params;

  res.json({
    ok: true,
    updated: {
      id: reservation_id,
      changes: req.body ?? {},
      status: 'updated'
    }
  });
});

app.delete('/api/staff/reservation/:reservation_id', (req: Request, res: Response) => {
  const { reservation_id } = req.params;

  res.json({ ok: true, deleted: { id: reservation_id, status: 'cancelled' } });
});

app.patch('/api/staff/reservation/:reservation_id/status', (req: Request, res: Response) => {
  const { reservation_id } = req.params;
  const status = req.body?.status ?? 'confirmed';

  res.json({ ok: true, reservation: { id: reservation_id, status } });
});

app.get('/api/staff/reservation/timeline', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    timeline: [
      { time: '18:00', table: 'Table 1', reservationId: 'res-1002' },
      { time: '19:00', table: 'Table 3', reservationId: 'res-1001' }
    ]
  });
});

app.get('/api/staff/table-blocks', (_req: Request, res: Response) => {
  res.json({ ok: true, blocks: [{ id: 'block-1', label: 'Connected tables', tables: ['Table 7', 'Table 8'] }] });
});

app.post('/api/staff/table-blocks', (req: Request, res: Response) => {
  res.status(201).json({ ok: true, block: { id: 'block-generated', ...req.body } });
});

app.delete('/api/staff/table-blocks/:block_id', (req: Request, res: Response) => {
  res.json({ ok: true, deleted: { id: req.params.block_id, status: 'removed' } });
});

app.post('/api/staff/reservation/merge', (_req: Request, res: Response) => {
  res.json({ ok: true, merged: true });
});

app.post('/api/staff/reservation/split', (_req: Request, res: Response) => {
  res.json({ ok: true, split: true });
});

app.get('/api/staff/resources/overview', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    resources: [
      { id: 'table-1', name: 'Table 1', capacity: 2, status: 'available' },
      { id: 'table-2', name: 'Table 2', capacity: 4, status: 'available' },
      { id: 'table-3', name: 'Table 3', capacity: 6, status: 'occupied' }
    ]
  });
});

app.get('/api/admin/user', (_req: Request, res: Response) => {
  res.json({ ok: true, users: [{ id: 'staff-1', name: 'Manager Test', role: 'manager' }] });
});

app.post('/api/admin/user', (_req: Request, res: Response) => {
  res.status(201).json({ ok: true, user: { id: 'staff-2', name: 'New Staff', role: 'staff' } });
});

app.patch('/api/admin/user/:user_id', (req: Request, res: Response) => {
  res.json({ ok: true, updated: { id: req.params.user_id, changes: req.body ?? {} } });
});

app.delete('/api/admin/user/:user_id', (req: Request, res: Response) => {
  res.json({ ok: true, deleted: { id: req.params.user_id } });
});

app.patch('/api/admin/user/:user_id/role', (req: Request, res: Response) => {
  res.json({ ok: true, updated: { id: req.params.user_id, role: req.body?.role ?? 'admin' } });
});

app.get('/api/admin/resource', (_req: Request, res: Response) => {
  res.json({ ok: true, resources: [{ id: 'table-1', name: 'Table 1', capacity: 2, zone: 'Garden' }] });
});

app.post('/api/admin/resource', (req: Request, res: Response) => {
  res.status(201).json({ ok: true, resource: { id: 'table-generated', ...req.body } });
});

app.delete('/api/admin/resource', (_req: Request, res: Response) => {
  res.json({ ok: true, deleted: true });
});

app.patch('/api/admin/resource/:resource_id', (req: Request, res: Response) => {
  res.json({ ok: true, updated: { id: req.params.resource_id, changes: req.body ?? {} } });
});

app.get('/api/admin/resource/zone', (_req: Request, res: Response) => {
  res.json({ ok: true, zones: [{ id: 'zone-1', name: 'Garden' }, { id: 'zone-2', name: 'Indoor' }] });
});

app.post('/api/admin/resource/zone', (req: Request, res: Response) => {
  res.status(201).json({ ok: true, zone: { id: 'zone-generated', ...req.body } });
});

app.delete('/api/admin/resource/zone', (_req: Request, res: Response) => {
  res.json({ ok: true, deleted: true });
});

app.patch('/api/admin/resource/zone/:zone_id', (req: Request, res: Response) => {
  res.json({ ok: true, updated: { id: req.params.zone_id, changes: req.body ?? {} } });
});

app.get('/api/admin/settings', (_req: Request, res: Response) => {
  res.json({ ok: true, settings: { slotMinutes: 30, archiveRetentionDays: 365 } });
});

app.patch('/api/admin/settings/:setting_name', (req: Request, res: Response) => {
  res.json({ ok: true, updated: { setting: req.params.setting_name, value: req.body?.value ?? null } });
});

app.get('/api/admin/logs', (_req: Request, res: Response) => {
  res.json({ ok: true, logs: [{ id: 'log-1', action: 'reservation.created', timestamp: new Date().toISOString() }] });
});

app.get('/api/admin/stats/reservations', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    stats: {
      totalReservations: 120,
      confirmed: 92,
      cancelled: 18,
      noShow: 10,
      byDay: [{ date: '2026-08-12', count: 18 }, { date: '2026-08-13', count: 22 }]
    }
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
});

export { app };
