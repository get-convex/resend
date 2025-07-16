import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
  "Remove old, delivered/bounced emails from database",
  { hours: 1 },
  internal.lib.cleanupOldEmails
);
crons.interval(
  "Remove abandoned emails from database that will never finalize",
  { hours: 1 },
  internal.lib.cleanupAbandonedEmails
);

export default crons;
