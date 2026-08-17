import type { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { hashSecret, verifySecret } from '../../auth/password.js';
import { requireAuth } from '../../middleware/auth.js';
import { addLog } from '../../data/adminRepository.js';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  createSession,
  createStaffUser,
  deleteSession,
  findStaffByEmail,
  findStaffByPinHolder,
  updateStaffUser
} from '../../data/staffRepository.js';
import { isNonEmptyString, toSafeUser } from '../../utils/helpers.js';
import type { StaffUser } from '../../data/mockData.js';
import { sendEmail } from '../../services/email.js';

export const setupStaffAuthRoutes = (router: Router) => {
  // Register new staff account (self-service creates manager account)
  router.post('/api/staff/register', async (req: Request, res: Response, next: NextFunction) => {
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

  // Login (email+password or PIN)
  router.post('/api/staff/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, pin } = req.body ?? {};

      let user: StaffUser | undefined;
      if (isNonEmptyString(pin)) {
        const candidate = await findStaffByPinHolder((u: StaffUser) => verifySecret(pin, u.pinHash));
        if (candidate) user = candidate;
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

  // Logout
  router.post('/api/staff/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      if (token) await deleteSession(token);
      res.json({ ok: true, loggedOut: true });
    } catch (error) {
      next(error);
    }
  });

  // Forgot password
  router.post('/api/staff/password/forgot', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body ?? {};
      if (!isNonEmptyString(email)) {
        res.status(400).json({ ok: false, message: 'email is required' });
        return;
      }

      const user = await findStaffByEmail(email);
      const response: { ok: true; message: string; resetToken?: string } = {
        ok: true,
        message: 'If that account exists, password reset instructions have been sent'
      };

      if (user) {
        const token = await createPasswordResetToken(user.id);
        response.resetToken = token;
        await addLog('staff.password.forgot', user.id);

        const host = req.get('host');
        const protocol = req.protocol;
        const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000';

        await sendEmail({
          to: user.email,
          subject: 'Obnovení hesla k personálnímu účtu',
          text: `Dobrý den ${user.name},\n\nobdrželi jsme žádost o obnovení Vašeho hesla.\n\nPro nastavení nového hesla použijte následující token:\n${token}\n\nNebo přejděte na:\n${baseUrl}/staff/login?resetToken=${encodeURIComponent(token)}\n\nTento token je platný po dobu 1 hodiny.\n\nPokud jste o změnu nežádali, tento e-mail můžete ignorovat.`
        });
      }

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // Reset password
  router.post('/api/staff/password/reset', async (req: Request, res: Response, next: NextFunction) => {
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
};
