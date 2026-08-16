import type { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { addLog } from '../data/adminRepository.js';
import {
  createReservation,
  getReservation,
  getResource,
  getSettings,
  listReservations,
  listResources,
  updateReservation
} from '../data/repository.js';
import type { Reservation } from '../data/mockData.js';

export const setupUserRoutes = (router: Router) => {
  // Guest settings
  router.get('/api/user/settings', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, settings: await getSettings() });
    } catch (error) {
      next(error);
    }
  });

  // List available resources
  router.get('/api/user/reservation/resources', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, resources: await listResources() });
    } catch (error) {
      next(error);
    }
  });

  // Book a reservation
  router.post('/api/user/reserve/:resource_id', async (req: Request<{ resource_id: string }>, res: Response, next: NextFunction) => {
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

  // View a reservation
  router.get('/api/user/reservation/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
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

  // Update a reservation
  router.patch('/api/user/reserve/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
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

  // Cancel a reservation
  router.delete('/api/user/reserve/:resource_id/:reservation_id', async (req: Request<{ resource_id: string; reservation_id: string }>, res: Response, next: NextFunction) => {
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
};
