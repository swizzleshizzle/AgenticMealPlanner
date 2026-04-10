import express from "express";
import cors from "cors";
import ingredientRoutes from "./routes/ingredients.js";
import mealRoutes from "./routes/meals.js";
import pantryRoutes from "./routes/pantry.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/ingredients", ingredientRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/pantry", pantryRoutes);

// Only start listening if this file is run directly (not imported for testing)
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
