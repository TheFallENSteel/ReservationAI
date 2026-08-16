import type { NextFunction, Request, Response } from 'express';

import { findStaffById, getSession } from '../data/staffRepository.js';
import type { StaffRole } from '../data/mockData.js';

export type SafeStaffUser = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staffUser?: SafeStaffUser;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      res.status(401).json({ ok: false, message: 'Authentication required' });
      return;
    }

    const session = await getSession(token);
    if (!session) {
      res.status(401).json({ ok: false, message: 'Invalid or expired session' });
      return;
    }

    const user = await findStaffById(session.userId);
    if (!user) {
      res.status(401).json({ ok: false, message: 'Invalid or expired session' });
      return;
    }

    req.staffUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: StaffRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.staffUser || !roles.includes(req.staffUser.role)) {
      res.status(403).json({ ok: false, message: 'Insufficient permissions' });
      return;
    }
    next();
  };
};
