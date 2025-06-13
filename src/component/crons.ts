import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "Remove old, delivered/bounced emails from database",
  { minutes: 5 }, // Every five minutes
  internal.lib.cleanupOldEmails
);

export default crons;
