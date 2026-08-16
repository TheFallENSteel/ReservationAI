import type { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { hashSecret } from '../auth/password.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  addLog,
  createZone,
  deleteZone,
  getReservationStats,
  listLogs,
  listZones,
  updateZone
} from '../data/adminRepository.js';
import {
  createResource,
  deleteResource,
  listResources,
  updateResource,
  updateSetting,
  getSettings
} from '../data/repository.js';
import {
  createStaffUser,
  deleteStaffUser,
  findStaffByEmail,
  findStaffById,
  listStaffUsers,
  updateStaffUser
} from '../data/staffRepository.js';
import { STAFF_ROLES, isNonEmptyString, toSafeUser } from '../utils/helpers.js';
import type { StaffUser } from '../data/mockData.js';

export const setupAdminRoutes = (router: Router) => {
  // List staff users
  router.get('/api/admin/user', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await listStaffUsers();
      res.json({ ok: true, users: users.map(toSafeUser) });
    } catch (error) {
      next(error);
    }
  });

  // Create staff user
  router.post('/api/admin/user', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
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

  // Update staff user
  router.patch('/api/admin/user/:user_id', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
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

  // Delete staff user
  router.delete('/api/admin/user/:user_id', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
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

  // Update staff role
  router.patch('/api/admin/user/:user_id/role', requireAuth, requireRole('admin'), async (req: Request<{ user_id: string }>, res: Response, next: NextFunction) => {
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

  // List resources
  router.get('/api/admin/resource', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, resources: await listResources() });
    } catch (error) {
      next(error);
    }
  });

  // Create resource
  router.post('/api/admin/resource', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
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

  // Delete resource
  router.delete('/api/admin/resource', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
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

  // Update resource
  router.patch('/api/admin/resource/:resource_id', requireAuth, requireRole('admin'), async (req: Request<{ resource_id: string }>, res: Response, next: NextFunction) => {
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

  // List zones
  router.get('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, zones: await listZones() });
    } catch (error) {
      next(error);
    }
  });

  // Create zone
  router.post('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
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

  // Delete zone
  router.delete('/api/admin/resource/zone', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
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

  // Update zone
  router.patch('/api/admin/resource/zone/:zone_id', requireAuth, requireRole('admin'), async (req: Request<{ zone_id: string }>, res: Response, next: NextFunction) => {
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

  // Get settings
  router.get('/api/admin/settings', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, settings: await getSettings() });
    } catch (error) {
      next(error);
    }
  });

  // Update setting
  router.patch('/api/admin/settings/:setting_name', requireAuth, requireRole('admin'), async (req: Request<{ setting_name: string }>, res: Response, next: NextFunction) => {
    try {
      const settings = await updateSetting(req.params.setting_name, req.body?.value ?? null);
      await addLog(`admin.settings.${req.params.setting_name}`, req.staffUser!.id);
      res.json({ ok: true, updated: { setting: req.params.setting_name, settings } });
    } catch (error) {
      next(error);
    }
  });

  // List logs
  router.get('/api/admin/logs', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, logs: await listLogs() });
    } catch (error) {
      next(error);
    }
  });

  // Get reservation stats
  router.get('/api/admin/stats/reservations', requireAuth, requireRole('admin'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, stats: await getReservationStats() });
    } catch (error) {
      next(error);
    }
  });
};
