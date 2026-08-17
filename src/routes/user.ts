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
import { createReservationVerification, verifyReservationCode, verifyReservationToken } from '../auth/verification.js';
import { sendReservationEmail } from '../services/email.js';

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

  // Public availability: returns active booked time intervals without exposing customer PII
  router.get('/api/user/reservation/availability', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date, resourceId } = req.query;
      const all = await listReservations();
      const active = all.filter((r) => !['cancelled', 'no_show'].includes(r.status));
      const filtered = active.filter((r) => {
        if (date && r.date !== String(date)) return false;
        if (resourceId && r.resourceId !== String(resourceId)) return false;
        return true;
      });

      res.json({
        ok: true,
        slots: filtered.map((r) => ({
          resourceId: r.resourceId,
          date: r.date,
          startTime: r.startTime,
          endTime: r.endTime
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  // Verify reservation 2FA via 6-digit code
  router.post('/api/user/reserve/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reservationId, code } = req.body ?? {};
      if (!reservationId || !code) {
        res.status(400).json({ ok: false, message: 'reservationId and code are required' });
        return;
      }

      const isValid = await verifyReservationCode(String(reservationId), String(code));
      if (!isValid) {
        res.status(400).json({ ok: false, message: 'Neplatný nebo vypršený ověřovací kód' });
        return;
      }

      const updated = await updateReservation(String(reservationId), { status: 'confirmed' });
      if (!updated) {
        res.status(404).json({ ok: false, message: 'Rezervace nebyla nalezena' });
        return;
      }

      await addLog('reservation.2fa_verified', 'guest');
      const resource = await getResource(updated.resourceId);

      // Send confirmation email after successful 2FA
      await sendReservationEmail('confirmation', updated, { tableName: resource?.name ?? updated.resourceId });

      res.json({ ok: true, verified: true, reservation: updated });
    } catch (error) {
      next(error);
    }
  });

  // Verify reservation 2FA via email link token
  router.get('/api/user/reserve/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = String(req.query.token ?? '');
      if (!token) {
        res.status(400).json({ ok: false, message: 'Ověřovací token chybí' });
        return;
      }

      const reservationId = await verifyReservationToken(token);
      if (!reservationId) {
        res.status(400).json({ ok: false, message: 'Neplatný nebo vypršený ověřovací odkaz' });
        return;
      }

      const updated = await updateReservation(reservationId, { status: 'confirmed' });
      if (!updated) {
        res.status(404).json({ ok: false, message: 'Rezervace nebyla nalezena' });
        return;
      }

      await addLog('reservation.link_verified', 'guest');
      const resource = await getResource(updated.resourceId);
      await sendReservationEmail('confirmation', updated, { tableName: resource?.name ?? updated.resourceId });

      res.json({ ok: true, verified: true, reservation: updated });
    } catch (error) {
      next(error);
    }
  });

  // Book a reservation (requires 2FA code / link verification)
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

      // Generate 2FA code and confirmation link
      const { code, token } = await createReservationVerification(created.id);

      const host = req.get('host');
      const protocol = req.protocol;
      const baseUrl = host ? `${protocol}://${host}` : undefined;

      // Dispatch 2FA verification email
      await sendReservationEmail(
        'verification2fa',
        created,
        {
          verificationCode: code,
          verificationToken: token,
          tableName: resource.name
        },
        baseUrl
      );

      res.status(201).json({
        ok: true,
        requires2fa: true,
        reservation: created,
        verificationToken: token
      });
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
      if (updated) {
        const resource = await getResource(updated.resourceId);
        await sendReservationEmail('change', updated, { tableName: resource?.name ?? updated.resourceId });
      }
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
      if (updated) {
        const resource = await getResource(updated.resourceId);
        await sendReservationEmail('cancellation', updated, { tableName: resource?.name ?? updated.resourceId });
      }
      res.json({ ok: true, deleted: updated });
    } catch (error) {
      next(error);
    }
  });
};
