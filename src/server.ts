import 'dotenv/config';

import { app } from './app.js';
import { startCronJobs } from './services/cron.js';

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Reservation API listening on http://localhost:${port}`);
  startCronJobs();
});
