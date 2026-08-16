import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { hasDatabase } from './db/client.js';
import { hashSecret, verifySecret } from './auth/password.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import {
  createReservation,
  createResource,
  deleteReservation,
  deleteResource,
  getReservation,
  getReservationsByIds,
  getResource,
  getSettings,
  listReservations,
  listResources,
  updateReservation,
  updateResource,
  updateSetting
} from './data/repository.js';
import {
  addLog,
  createTableBlock,
  createZone,
  deleteTableBlock,
  deleteZone,
  getReservationStats,
  listLogs,
  listTableBlocks,
  listZones,
  updateZone
} from './data/adminRepository.js';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  createSession,
  createStaffUser,
  deleteSession,
  deleteStaffUser,
  findStaffByEmail,
  findStaffById,
  findStaffByPinHolder,
  listStaffUsers,
  updateStaffUser
} from './data/staffRepository.js';
import type { Reservation, StaffRole, StaffUser } from './data/mockData.js';

const app = express();

app.use(express.json());

const STAFF_ROLES: StaffRole[] = ['admin', 'manager', 'staff'];

const toSafeUser = (user: StaffUser) => ({ id: user.id, name: user.name, email: user.email, role: user.role });

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Static frontend (public/) - served directly by Vercel in production; via express.static locally.
const publicDir = path.join(process.cwd(), 'public');
app.use('/public', express.static(publicDir));

const sendPage = (file: string) => (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, file));
};

app.get('/', sendPage('index.html'));
app.get('/reserve', sendPage('reserve.html'));
app.get('/reserve/manage', sendPage('reserve-manage.html'));
app.get('/staff/login', sendPage('staff/login.html'));
app.get('/staff/dashboard', sendPage('staff/dashboard.html'));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'reservation-system', database: hasDatabase ? 'neon' : 'in-memory' });
});

// ---------------------------------------------------------------------------
// User (guest) endpoints - no authentication required
// ---------------------------------------------------------------------------

app.get('/api/user/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, settings: await getSettings() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/user/reservation/resources', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, resources: await listResources() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/user/reserve/:resource_id', async (req: Request<{ resource_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { resource_id } = req.params;
    const resource = await getResource(resource_id);
    if (!resource) {
      res.status(404).json({ ok: false, message: `Resource ${resource_id} not found` });
      return;
    }

    const payload = req.body ?? {};
    const reservation: Reservation = {
      id: `res-${randomUUID()}`,
      resourceId: resource_id,
      guestName: payload.guestName ?? 'Guest',
      email: payload.email ?? '',
      phone: payload.phone ?? '',
      guestCount: payload.guestCount ?? resource.minGuests,
      date: payload.date ?? '',
      startTime: payload.startTime ?? '',
      endTime: payload.endTime ?? '',
      status: 'pending',
      notes: payload.notes
    };

    const created = await createReservation(reservation);
    await addLog('reservation.created', 'guest');
    res.status(201).json({ ok: true, reservation: created });
  } catch (error) {
    next(error);
  }
});

app.get('/api/user/reservation/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { resource_id, reservation_id } = req.params;
    const reservation = await getReservation(reservation_id);
    if (!reservation || reservation.resourceId !== resource_id) {
      res.status(404).json({ ok: false, message: `Reservation ${reservation_id} not found` });
      return;
    }

    res.json({ ok: true, reservation });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/user/reserve/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { resource_id, reservation_id } = req.params;
    const existing = await getReservation(reservation_id);
    if (!existing || existing.resourceId !== resource_id) {
      res.status(404).json({ ok: false, message: `Reservation ${reservation_id} not found` });
      return;
    }

    const updated = await updateReservation(reservation_id, req.body ?? {});
    res.json({ ok: true, updated });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/user/reserve/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { resource_id, reservation_id } = req.params;
    const existing = await getReservation(reservation_id);
    if (!existing || existing.resourceId !== resource_id) {
      res.status(404).json({ ok: false, message: `Reservation ${reservation_id} not found` });
      return;
    }

    const updated = await updateReservation(reservation_id, { status: 'cancelled' });
    res.json({ ok: true, deleted: updated });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Staff auth endpoints - public (no session required yet)
// ---------------------------------------------------------------------------

app.post('/api/staff/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body ?? {};
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ ok: false, message: 'name, email and password are required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ ok: false, message: 'password must be at least 8 characters' });
      return;
    }

    const existing = await findStaffByEmail(email);
    if (existing) {
      res.status(409).json({ ok: false, message: 'An account with this email already exists' });
      return;
    }

    // Self-service registration always creates a manager account; admin/staff accounts are provisioned via /api/admin/user.
    const user = await createStaffUser({
      id: `staff-${randomUUID()}`,
      name,
      email,
      role: 'manager',
      passwordHash: hashSecret(password)
    });

    await addLog('staff.registered', user.id);
    res.status(201).json({ ok: true, user: toSafeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, pin } = req.body ?? {};

    let user: StaffUser | undefined;
    if (isNonEmptyString(pin)) {
      user = await findStaffByPinHolder((candidate) => verifySecret(pin, candidate.pinHash));
    } else if (isNonEmptyString(email) && isNonEmptyString(password)) {
      const candidate = await findStaffByEmail(email);
      if (candidate && verifySecret(password, candidate.passwordHash)) {
        user = candidate;
      }
    }

    if (!user) {
      res.status(401).json({ ok: false, message: 'Invalid credentials' });
      return;
    }

    const session = await createSession(user.id);
    await addLog('staff.login', user.id);
    res.json({ ok: true, token: session.token, user: toSafeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/password/forgot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body ?? {};
    if (!isNonEmptyString(email)) {
      res.status(400).json({ ok: false, message: 'email is required' });
      return;
    }

    const user = await findStaffByEmail(email);
    // Always return a generic response so this endpoint can't be used to enumerate registered emails.
    const response: { ok: true; message: string; resetToken?: string } = {
      ok: true,
      message: 'If that account exists, password reset instructions have been sent'
    };

    if (user) {
      // No email provider is wired up in this demo; the token is returned directly instead of emailed.
      // In a real deployment, send this via email and remove it from the API response.
      response.resetToken = await createPasswordResetToken(user.id);
      await addLog('staff.password.forgot', user.id);
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/password/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (!isNonEmptyString(token) || !isNonEmptyString(newPassword)) {
      res.status(400).json({ ok: false, message: 'token and newPassword are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ ok: false, message: 'newPassword must be at least 8 characters' });
      return;
    }

    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      res.status(400).json({ ok: false, message: 'Reset token is invalid or expired' });
      return;
    }

    await updateStaffUser(userId, { passwordHash: hashSecret(newPassword) });
    await addLog('staff.password.reset', userId);
    res.json({ ok: true, message: 'Password reset successful' });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Staff endpoints - require an authenticated session (any role)
// ---------------------------------------------------------------------------

app.post('/api/staff/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (token) await deleteSession(token);
    res.json({ ok: true, loggedOut: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/me', requireAuth, (req: Request, res: Response) => {
  res.json({ ok: true, user: req.staffUser });
});

app.patch('/api/staff/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body ?? {};
    const changes: Partial<StaffUser> = {};
    if (isNonEmptyString(name)) changes.name = name;
    if (isNonEmptyString(email)) changes.email = email;

    const updated = await updateStaffUser(req.staffUser!.id, changes);
    res.json({ ok: true, updated: updated ? toSafeUser(updated) : undefined });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/reservation', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, reservations: await listReservations() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/reservation', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body ?? {};
    const reservation: Reservation = {
      id: `res-${randomUUID()}`,
      resourceId: payload.resourceId ?? '',
      guestName: payload.guestName ?? 'New Guest',
      email: payload.email ?? '',
      phone: payload.phone ?? '',
      guestCount: payload.guestCount ?? 1,
      date: payload.date ?? '',
      startTime: payload.startTime ?? '',
      endTime: payload.endTime ?? '',
      status: 'confirmed',
      notes: payload.notes
    };

    const created = await createReservation(reservation);
    await addLog('reservation.created', req.staffUser!.id);
    res.status(201).json({ ok: true, reservation: created });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/reservation/timeline', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = isNonEmptyString(req.query.date) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
    const all = await listReservations();
    const timeline = all
      .filter((reservation) => reservation.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((reservation) => ({
        time: reservation.startTime,
        resourceId: reservation.resourceId,
        reservationId: reservation.id,
        guestName: reservation.guestName,
        guestCount: reservation.guestCount,
        blockId: reservation.blockId
      }));

    res.json({ ok: true, date, timeline });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const reservation = await getReservation(req.params.reservation_id);
    if (!reservation) {
      res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
      return;
    }

    res.json({ ok: true, reservation });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const updated = await updateReservation(req.params.reservation_id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
      return;
    }

    await addLog('reservation.updated', req.staffUser!.id);
    res.json({ ok: true, updated });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const deleted = await deleteReservation(req.params.reservation_id);
    if (!deleted) {
      res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
      return;
    }

    await addLog('reservation.deleted', req.staffUser!.id);
    res.json({ ok: true, deleted });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/staff/reservation/:reservation_id/status', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
  try {
    const status = req.body?.status ?? 'confirmed';
    const reservation = await updateReservation(req.params.reservation_id, { status });
    if (!reservation) {
      res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
      return;
    }

    await addLog(`reservation.status.${status}`, req.staffUser!.id);
    res.json({ ok: true, reservation });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/table-blocks', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, blocks: await listTableBlocks() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/table-blocks', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body ?? {};
    if (!Array.isArray(payload.tableIds) || payload.tableIds.length < 2) {
      res.status(400).json({ ok: false, message: 'tableIds must include at least two table ids' });
      return;
    }

    const block = await createTableBlock({
      id: `block-${randomUUID()}`,
      label: payload.label ?? 'Connected tables',
      tableIds: payload.tableIds,
      date: payload.date ?? new Date().toISOString().slice(0, 10),
      startTime: payload.startTime ?? '00:00',
      endTime: payload.endTime ?? '23:59'
    });

    res.status(201).json({ ok: true, block });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/staff/table-blocks/:block_id', requireAuth, async (req: Request<{ block_id: string }>, res: Response, next: NextFunction) => {
  try {
    const all = await listReservations();
    const linked = all.filter((reservation) => reservation.blockId === req.params.block_id);
    for (const reservation of linked) {
      await updateReservation(reservation.id, { blockId: undefined });
    }

    const deleted = await deleteTableBlock(req.params.block_id);
    if (!deleted) {
      res.status(404).json({ ok: false, message: `Table block ${req.params.block_id} not found` });
      return;
    }

    res.json({ ok: true, deleted: { id: req.params.block_id, status: 'removed' } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/reservation/merge', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reservationIds, label } = req.body ?? {};
    if (!Array.isArray(reservationIds) || reservationIds.length < 2) {
      res.status(400).json({ ok: false, message: 'reservationIds must include at least two reservation ids' });
      return;
    }

    const matched = await getReservationsByIds(reservationIds);
    if (matched.length !== reservationIds.length) {
      res.status(404).json({ ok: false, message: 'One or more reservations were not found' });
      return;
    }

    const tableIds = [...new Set(matched.map((reservation) => reservation.resourceId))];
    const startTime = matched.map((reservation) => reservation.startTime).sort()[0];
    const endTime = matched.map((reservation) => reservation.endTime).sort().slice(-1)[0];

    const block = await createTableBlock({
      id: `block-${randomUUID()}`,
      label: label ?? 'Merged tables',
      tableIds,
      date: matched[0].date,
      startTime,
      endTime
    });

    const updatedReservations: Reservation[] = [];
    for (const reservation of matched) {
      const updated = await updateReservation(reservation.id, { blockId: block.id });
      if (updated) updatedReservations.push(updated);
    }

    await addLog('reservation.merge', req.staffUser!.id);
    res.status(201).json({ ok: true, block, reservations: updatedReservations });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/reservation/split', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { blockId } = req.body ?? {};
    if (!isNonEmptyString(blockId)) {
      res.status(400).json({ ok: false, message: 'blockId is required' });
      return;
    }

    const all = await listReservations();
    const linked = all.filter((reservation) => reservation.blockId === blockId);
    if (linked.length === 0) {
      res.status(404).json({ ok: false, message: `Table block ${blockId} not found` });
      return;
    }

    for (const reservation of linked) {
      await updateReservation(reservation.id, { blockId: undefined });
    }
    await deleteTableBlock(blockId);

    await addLog('reservation.split', req.staffUser!.id);
    res.json({ ok: true, released: linked.map((reservation) => reservation.id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/resources/overview', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, resources: await listResources() });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints - require an authenticated session with the admin role
// ---------------------------------------------------------------------------

app.get('/api/admin/user', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await listStaffUsers();
    res.json({ ok: true, users: users.map(toSafeUser) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/user', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ ok: false, message: 'name, email and password are required' });
      return;
    }
    if (!STAFF_ROLES.includes(role)) {
      res.status(400).json({ ok: false, message: `role must be one of ${STAFF_ROLES.join(', ')}` });
      return;
    }

    const existing = await findStaffByEmail(email);
    if (existing) {
      res.status(409).json({ ok: false, message: 'An account with this email already exists' });
      return;
    }

    const user = await createStaffUser({
      id: `staff-${randomUUID()}`,
      name,
      email,
      role,
      passwordHash: hashSecret(password)
    });

    await addLog('admin.user.created', req.staffUser!.id);
    res.status(201).json({ ok: true, user: toSafeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/user/:user_id', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body ?? {};
    const changes: Partial<StaffUser> = {};
    if (isNonEmptyString(name)) changes.name = name;
    if (isNonEmptyString(email)) changes.email = email;

    const updated = await updateStaffUser(req.params.user_id, changes);
    if (!updated) {
      res.status(404).json({ ok: false, message: `User ${req.params.user_id} not found` });
      return;
    }

    res.json({ ok: true, updated: toSafeUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/user/:user_id', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
  try {
    if (req.staffUser!.id === req.params.user_id) {
      res.status(400).json({ ok: false, message: 'You cannot delete your own account' });
      return;
    }

    const deleted = await deleteStaffUser(req.params.user_id);
    if (!deleted) {
      res.status(404).json({ ok: false, message: `User ${req.params.user_id} not found` });
      return;
    }

    await addLog('admin.user.deleted', req.staffUser!.id);
    res.json({ ok: true, deleted: { id: req.params.user_id } });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/user/:user_id/role', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body ?? {};
    if (!STAFF_ROLES.includes(role)) {
      res.status(400).json({ ok: false, message: `role must be one of ${STAFF_ROLES.join(', ')}` });
      return;
    }

    const updated = await updateStaffUser(req.params.user_id, { role });
    if (!updated) {
      res.status(404).json({ ok: false, message: `User ${req.params.user_id} not found` });
      return;
    }

    await addLog('admin.user.role_changed', req.staffUser!.id);
    res.json({ ok: true, updated: toSafeUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/resource', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, resources: await listResources() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/resource', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body ?? {};
    const resource = {
      id: payload.id ?? `table-${randomUUID()}`,
      name: payload.name ?? 'New table',
      capacity: payload.capacity ?? 2,
      zone: payload.zone ?? 'Main',
      status: payload.status ?? 'available',
      minGuests: payload.minGuests ?? 1,
      maxGuests: payload.maxGuests ?? payload.capacity ?? 2
    } as const;

    const created = await createResource({ ...resource });
    await addLog('admin.resource.created', req.staffUser!.id);
    res.status(201).json({ ok: true, resource: created });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/resource', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resourceId = (req.body?.id ?? req.query.id) as string | undefined;
    if (!resourceId) {
      res.status(400).json({ ok: false, message: 'Resource id is required' });
      return;
    }

    const deleted = await deleteResource(resourceId);
    if (!deleted) {
      res.status(404).json({ ok: false, message: `Resource ${resourceId} not found` });
      return;
    }

    await addLog('admin.resource.deleted', req.staffUser!.id);
    res.json({ ok: true, deleted: true });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/resource/:resource_id', requireAuth, requireRole('admin'), async (req: Request<{ resource_id: string }>, res: Response, next: NextFunction) => {
  try {
    const updated = await updateResource(req.params.resource_id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ ok: false, message: `Resource ${req.params.resource_id} not found` });
      return;
    }

    res.json({ ok: true, updated });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, zones: await listZones() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body ?? {};
    if (!isNonEmptyString(name)) {
      res.status(400).json({ ok: false, message: 'name is required' });
      return;
    }

    const zone = await createZone({ id: `zone-${randomUUID()}`, name });
    res.status(201).json({ ok: true, zone });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneId = (req.body?.id ?? req.query.id) as string | undefined;
    if (!zoneId) {
      res.status(400).json({ ok: false, message: 'Zone id is required' });
      return;
    }

    const deleted = await deleteZone(zoneId);
    if (!deleted) {
      res.status(404).json({ ok: false, message: `Zone ${zoneId} not found` });
      return;
    }

    res.json({ ok: true, deleted: true });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/resource/zone/:zone_id', requireAuth, requireRole('admin'), async (req: Request<{ zone_id: string }>, res: Response, next: NextFunction) => {
  try {
    const updated = await updateZone(req.params.zone_id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ ok: false, message: `Zone ${req.params.zone_id} not found` });
      return;
    }

    res.json({ ok: true, updated });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/settings', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, settings: await getSettings() });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/settings/:setting_name', requireAuth, requireRole('admin'), async (req: Request<{ setting_name: string }>, res: Response, next: NextFunction) => {
  try {
    const settings = await updateSetting(req.params.setting_name, req.body?.value ?? null);
    await addLog(`admin.settings.${req.params.setting_name}`, req.staffUser!.id);
    res.json({ ok: true, updated: { setting: req.params.setting_name, settings } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/logs', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, logs: await listLogs() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/stats/reservations', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ok: true, stats: await getReservationStats() });
  } catch (error) {
    next(error);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
});

export { app };
