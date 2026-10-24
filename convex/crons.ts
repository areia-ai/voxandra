import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Process pending emails every 5 minutes
crons.interval(
  "process pending emails",
  { minutes: 5 },
  internal.emailCron.processPendingEmails,
  {}
);

crons.interval(
  "cleanup operational records",
  { hours: 24 },
  internal.maintenance.cleanupOperationalRecords,
  {}
);

// Credits reserved for a call whose terminal provider callback never arrived
// stay reserved forever otherwise — the failure mode that trapped $37.80 in
// the 2026-07-30 translated-bridge incident. Every provider leg is capped at
// its reservation's own `reservedSeconds`, so anything past that plus a grace
// window is definitionally abandoned.
crons.interval(
  "sweep abandoned call reservations",
  { minutes: 10 },
  internal.twilioLifecycle.sweepAbandonedCallReservations,
  {}
);

export default crons;
