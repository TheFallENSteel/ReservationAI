import express, { type Request, type Response, type NextFunction, Router } from 'express';
import path from 'node:path';

import { hasDatabase } from './db/client.js';
import { setupUserRoutes } from './routes/user.js';
import { setupStaffAuthRoutes } from './routes/staff/auth.js';
import { setupStaffRoutes } from './routes/staff/index.js';
import { setupAdminRoutes } from './routes/admin.js';

const app = express();

app.use(express.json());

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

// Mount all route handlers
const router = Router();
setupUserRoutes(router);
setupStaffAuthRoutes(router);
setupStaffRoutes(router);
setupAdminRoutes(router);
app.use(router);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
});

export default app;
export { app };
