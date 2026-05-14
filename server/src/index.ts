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

export const app = express();
const PORT = process.env.PORT || 3001;

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

ensurePopplerAvailable().then(({ pdfimages, pdftoppm }) => {
  if (!pdfimages || !pdftoppm) {
    console.warn(`[boot] poppler-utils missing: pdfimages=${pdfimages} pdftoppm=${pdftoppm}. Thumbnail extraction disabled.`);
  }
});

// Only start listening if not running under vitest (VITEST is set by vitest automatically)
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Nightly at 03:00 server time. Skipped under vitest.
  cron.schedule("0 3 * * *", async () => {
    try {
      const count = await purgeConsumedBatches();
      console.log(`[purge] removed ${count} consumed pantry batches older than 30 days`);
    } catch (e) {
      console.error("[purge] failed:", e);
    }
  });
}

export default app;
