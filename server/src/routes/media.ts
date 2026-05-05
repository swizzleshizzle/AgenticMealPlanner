import { Router } from "express";
import path from "path";
import { access } from "fs/promises";
import { constants as FS } from "fs";
import { mealPdfPath, mealThumbPath } from "../services/mediaStorage.js";

const router = Router();

// dotfiles: "allow" — without this, sendFile 404s any resolved path that
// passes through a dotfile-prefixed directory (e.g. a `.worktrees/...`
// deployment). Path safety is already enforced above: we only build the
// path from the validated numeric :id, never from request input.
const SEND_OPTS = { dotfiles: "allow" } as const;

router.get("/meals/:id/thumb.jpg", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).end();
  const p = mealThumbPath(id);
  try { await access(p, FS.R_OK); } catch { return res.status(404).end(); }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.resolve(p), SEND_OPTS);
});

router.get("/meals/:id/source.pdf", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).end();
  const p = mealPdfPath(id);
  try { await access(p, FS.R_OK); } catch { return res.status(404).end(); }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="recipe-${id}.pdf"`);
  res.sendFile(path.resolve(p), SEND_OPTS);
});

export default router;
