/** Scheduled automation (reminders & alerts). Run every 15 minutes from cron or your host's scheduler. */
import { runScheduledJobs } from "../src/services/automation";
import { prisma } from "../src/lib/db";

runScheduledJobs()
  .then((counts) => {
    console.log(new Date().toISOString(), "notifications sent:", JSON.stringify(counts));
    return prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
