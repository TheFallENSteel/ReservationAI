import type { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { requireAuth } from '../../middleware/auth.js';
import { addLog, createTableBlock, deleteTableBlock, listTableBlocks } from '../../data/adminRepository.js';
import {
  createReservation,
  deleteReservation,
  getReservation,
  getReservationsByIds,
  getResource,
  listReservations,
  listResources,
  updateReservation
} from '../../data/repository.js';
import { updateStaffUser, findStaffById } from '../../data/staffRepository.js';
import type { Reservation } from '../../data/mockData.js';
import { isNonEmptyString, toSafeUser } from '../../utils/helpers.js';
import { sendReservationEmail } from '../../services/email.js';

export const setupStaffRoutes = (router: Router) => {
  // Get current user
  router.get('/api/staff/me', requireAuth, (req: Request, res: Response) => {
    res.json({ ok: true, user: req.staffUser });
  });

  // Update current user
  router.patch('/api/staff/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email } = req.body ?? {};
      const changes: any = {};
      if (isNonEmptyString(name)) changes.name = name;
      if (isNonEmptyString(email)) changes.email = email;

      const updated = await updateStaffUser(req.staffUser!.id, changes);
      res.json({ ok: true, updated: updated ? toSafeUser(updated) : undefined });
    } catch (error) {
      next(error);
    }
  });

  // List all reservations
  router.get('/api/staff/reservation', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, reservations: await listReservations() });
    } catch (error) {
      next(error);
    }
  });

  // Create a reservation
  router.post('/api/staff/reservation', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
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

      const resource = await getResource(created.resourceId);
      await sendReservationEmail('confirmation', created, { tableName: resource?.name ?? created.resourceId });

      res.status(201).json({ ok: true, reservation: created });
    } catch (error) {
      next(error);
    }
  });

  // Get a reservation
  router.get('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
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

  // Update a reservation
  router.patch('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
    try {
      const updated = await updateReservation(req.params.reservation_id, req.body ?? {});
      if (!updated) {
        res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
        return;
      }

      await addLog('reservation.updated', req.staffUser!.id);
      const resource = await getResource(updated.resourceId);
      if (updated.status === 'cancelled') {
        await sendReservationEmail('cancellation', updated, { tableName: resource?.name ?? updated.resourceId });
      } else {
        await sendReservationEmail('change', updated, { tableName: resource?.name ?? updated.resourceId });
      }

      res.json({ ok: true, updated });
    } catch (error) {
      next(error);
    }
  });

  // Delete a reservation
  router.delete('/api/staff/reservation/:reservation_id', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteReservation(req.params.reservation_id);
      if (!deleted) {
        res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
        return;
      }

      await addLog('reservation.deleted', req.staffUser!.id);
      const resource = await getResource(deleted.resourceId);
      await sendReservationEmail('cancellation', deleted, { tableName: resource?.name ?? deleted.resourceId });

      res.json({ ok: true, deleted });
    } catch (error) {
      next(error);
    }
  });

  // Update reservation status
  router.patch('/api/staff/reservation/:reservation_id/status', requireAuth, async (req: Request<{ reservation_id: string }>, res: Response, next: NextFunction) => {
    try {
      const status = req.body?.status ?? 'confirmed';
      const reservation = await updateReservation(req.params.reservation_id, { status });
      if (!reservation) {
        res.status(404).json({ ok: false, message: `Reservation ${req.params.reservation_id} not found` });
        return;
      }

      await addLog(`reservation.status.${status}`, req.staffUser!.id);
      const resource = await getResource(reservation.resourceId);
      if (status === 'cancelled') {
        await sendReservationEmail('cancellation', reservation, { tableName: resource?.name ?? reservation.resourceId });
      }

      res.json({ ok: true, reservation });
    } catch (error) {
      next(error);
    }
  });

  // Get reservation timeline for a date
  router.get('/api/staff/reservation/timeline', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const date = isNonEmptyString(req.query.date) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
      const all = await listReservations();
      const timeline = all
        .filter((reservation: Reservation) => reservation.date === date)
        .sort((a: Reservation, b: Reservation) => a.startTime.localeCompare(b.startTime))
        .map((reservation: Reservation) => ({
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

  // List table blocks
  router.get('/api/staff/table-blocks', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, blocks: await listTableBlocks() });
    } catch (error) {
      next(error);
    }
  });

  // Create a table block
  router.post('/api/staff/table-blocks', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
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

  // Delete a table block
  router.delete('/api/staff/table-blocks/:block_id', requireAuth, async (req: Request<{ block_id: string }>, res: Response, next: NextFunction) => {
    try {
      const all = await listReservations();
      const linked = all.filter((reservation: Reservation) => reservation.blockId === req.params.block_id);
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

  // Merge reservations into a table block
  router.post('/api/staff/reservation/merge', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
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

      const tableIds = [...new Set(matched.map((reservation: Reservation) => reservation.resourceId))];
      const startTime = matched.map((reservation: Reservation) => reservation.startTime).sort()[0];
      const endTime = matched.map((reservation: Reservation) => reservation.endTime).sort().slice(-1)[0];

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

  // Split a merged reservation
  router.post('/api/staff/reservation/split', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { blockId } = req.body ?? {};
      if (!isNonEmptyString(blockId)) {
        res.status(400).json({ ok: false, message: 'blockId is required' });
        return;
      }

      const all = await listReservations();
      const linked = all.filter((reservation: Reservation) => reservation.blockId === blockId);
      if (linked.length === 0) {
        res.status(404).json({ ok: false, message: `Table block ${blockId} not found` });
        return;
      }

      for (const reservation of linked) {
        await updateReservation(reservation.id, { blockId: undefined });
      }
      await deleteTableBlock(blockId);

      await addLog('reservation.split', req.staffUser!.id);
      res.json({ ok: true, released: linked.map((reservation: Reservation) => reservation.id) });
    } catch (error) {
      next(error);
    }
  });

  // Resources overview
  router.get('/api/staff/resources/overview', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, resources: await listResources() });
    } catch (error) {
      next(error);
    }
  });
};
