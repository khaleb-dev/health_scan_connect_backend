import { CronJob } from 'cron';

export const keepAlive = () => {
  // runs every 13 minute
  const job = new CronJob('*/13 * * * *', async function () {
    await fetch('https://health-scan-connect-backend.onrender.com/api/health');
  });

  try {
    job.start();
  } catch (error) {
    console.warn(`CRON error (keepAlive): ${error}`);
  }
};