import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import ingredientRoutes from "./routes/ingredients.js";
import mealRoutes from "./routes/meals.js";
import pantryRoutes from "./routes/pantry.js";
import planRoutes from "./routes/plans.js";
import shoppingRoutes from "./routes/shopping.js";
import chatRoutes from "./routes/chat.js";
import calendarRoutes from "./routes/calendar.js";
import mediaRouter from "./routes/media.js";
import receiptRoutes from "./routes/receipts.js";
import { ensurePopplerAvailable } from "./services/pdfExtraction.js";
import { purgeConsumedBatches } from "./jobs/purgeConsumedBatches.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./lib/errorHandler.js";

// Fail fast on missing required configuration rather than booting a server that
// answers /api/health "ok" and then 500s on the first DB query.
if (!process.env.DATABASE_URL) {
  console.error("[boot] FATAL: DATABASE_URL is not set. Refusing to start.");
  process.exit(1);
}

export const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/ingredients", ingredientRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/pantry", pantryRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/shopping", shoppingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/media", mediaRouter);
app.use("/api/receipts", receiptRoutes);

// Terminal error handler — must be registered after all routes.
app.use(errorHandler);

ensurePopplerAvailable().then(({ pdfimages, pdftoppm }) => {
  if (!pdfimages || !pdftoppm) {
    console.warn(`[boot] poppler-utils missing: pdfimages=${pdfimages} pdftoppm=${pdftoppm}. Thumbnail extraction disabled.`);
  }
});

// Only start listening if not running under vitest (VITEST is set by vitest automatically)
if (!process.env.VITEST) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Nightly purge. Timezone is pinned explicitly (overridable) so a host TZ
  // change can't silently shift the maintenance window. The isRunning guard
  // prevents overlapping runs from stacking if one ever exceeds 24h.
  let purgeRunning = false;
  cron.schedule(
    "0 3 * * *",
    async () => {
      if (purgeRunning) {
        console.warn("[purge] previous run still in progress; skipping this tick");
        return;
      }
      purgeRunning = true;
      try {
        const count = await purgeConsumedBatches();
        console.log(`[purge] removed ${count} consumed pantry batches older than 30 days`);
      } catch (e) {
        console.error("[purge] failed:", e);
      } finally {
        purgeRunning = false;
      }
    },
    { timezone: process.env.CRON_TIMEZONE || "America/New_York" },
  );

  // Graceful shutdown: stop accepting connections, then close the DB pool.
  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received; closing server...`);
    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch (e) {
        console.error("[shutdown] error disconnecting Prisma:", e);
      }
      process.exit(0);
    });
    // Force-exit if close hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export default app;
