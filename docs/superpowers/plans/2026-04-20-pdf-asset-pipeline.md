# PDF Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist uploaded recipe PDFs, auto-extract card thumbnails, and give the user manual override buttons (Replace photo / Upload PDF / Re-run extraction).

**Architecture:** Filesystem storage under `server/storage/meals/{id}/`, served by a new `/media/...` Express route. Cascading extraction: `pdfimages` → largest embedded image → `pdftoppm` page rasterization → null (UI SVG fallback). Three new DB columns on `Meal`. Manual backfill script for existing uploads.

**Tech Stack:** Node 20 + Express + Prisma/Postgres, `poppler-utils` (system package), `fuse.js` (npm), React 18 + Tailwind v4 client, `lucide-react`, multer for uploads.

---

## File Structure

### Create

- `server/src/services/mediaStorage.ts` — path helpers, mkdirp, SHA-256 file hashing.
- `server/src/services/pdfExtraction.ts` — `runThumbnailJob` cascade + `ensurePopplerAvailable`.
- `server/src/routes/media.ts` — `GET /media/meals/:id/thumb.jpg` and `source.pdf`.
- `server/src/services/importSessions.ts` — in-memory Map with TTL for `importSessionId`.
- `server/src/scripts/backfill-pdfs.ts` — one-shot filename → meal fuzzy matcher + extractor.
- `server/src/__tests__/mediaStorage.test.ts` — unit tests for path + hash logic.
- `server/src/__tests__/pdfExtraction.test.ts` — unit tests for size/aspect gate logic.
- `server/src/__tests__/importSessions.test.ts` — unit tests for TTL behavior.

### Modify

- `server/prisma/schema.prisma` — add `pdfPath`, `imagePath`, `imageSource` to `Meal`.
- `server/src/routes/meals.ts` — add `POST /:id/photo`, `POST /:id/pdf`, `POST /:id/extract-thumbnail`; thread `importSessionId` into create.
- `server/src/services/mealService.ts` — honor `importSessionId` on create; expose photo/pdf/extract service calls.
- `server/src/middleware/upload.ts` — add `imageOnly` and `pdfOnly` multer instances with MIME filters.
- `server/src/claude/recipeParser.ts` — have `POST /api/meals/import` return a session id and stash the tmp PDF path.
- `server/src/index.ts` — mount media router, call `ensurePopplerAvailable()` at boot.
- `server/package.json` — add `fuse.js` dep.
- `.gitignore` — add `server/storage/`.
- `client/src/api/meals.ts` — extend `Meal` type with `pdfPath`, `imagePath`, `imageSource`; add three upload helpers.
- `client/src/components/MealCard.tsx` — prefer `imagePath`, `<img onError>` falls back to `PhotoTile`.
- `client/src/pages/Dashboard.tsx` — same fallback in hero + other-meals row.
- `client/src/pages/RecipeDetail.tsx` — replace the paper modal "Original PDF" handler with an external-link to `/media/...`; add action row (Replace photo / Upload PDF / Re-run extraction).

---

## Task 1: Install poppler + ignore storage dir

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Install poppler-utils on the dev server**

Run from dev machine:
```bash
ssh meal-server "sudo apt-get update && sudo apt-get install -y poppler-utils && which pdfimages pdftoppm"
```
Expected: two paths printed, one per binary. If not installed, the `apt-get` line installs them.

- [ ] **Step 2: Add storage dir to .gitignore**

Append to `.gitignore` (root of repo):
```
server/storage/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore server/storage/"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: new migration folder under `server/prisma/migrations/`

- [ ] **Step 1: Edit schema.prisma**

Open `server/prisma/schema.prisma`. Find the `Meal` model. Add three fields just above the `createdAt` line:

```prisma
  pdfPath     String?  @map("pdf_path")
  imagePath   String?  @map("image_path")
  imageSource String?  @map("image_source")
```

- [ ] **Step 2: Generate + apply migration on the dev server**

From dev machine:
```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && npx prisma migrate dev --name add_pdf_pipeline"
```
Expected: "Applied migration ..." + Prisma Client regenerated. The migration SQL appears under `server/prisma/migrations/<timestamp>_add_pdf_pipeline/migration.sql`.

- [ ] **Step 3: Pull the generated migration back to dev machine**

```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git add -A server/prisma/migrations && git diff --cached --stat"
```
Expected: one new migration file staged.

```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git stash"
git pull --rebase origin master   # no-op, but syncs
scp meal-server:/home/swizz/projects/AgenticMealPlanner/server/prisma/migrations/*_add_pdf_pipeline/migration.sql /tmp/mig.sql
ls server/prisma/migrations/ | tail -3
# create matching dir locally
MIGDIR=$(ssh meal-server "ls -d /home/swizz/projects/AgenticMealPlanner/server/prisma/migrations/*_add_pdf_pipeline" | xargs basename)
mkdir -p "server/prisma/migrations/$MIGDIR"
cp /tmp/mig.sql "server/prisma/migrations/$MIGDIR/migration.sql"
```

- [ ] **Step 4: Verify schema + migration locally**

```bash
git status server/prisma/
```
Expected: `schema.prisma` modified + `migrations/<timestamp>_add_pdf_pipeline/migration.sql` new.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(db): add pdf_path, image_path, image_source to meals"
git push origin master
```

---

## Task 3: Media storage helper

**Files:**
- Create: `server/src/services/mediaStorage.ts`
- Create: `server/src/__tests__/mediaStorage.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/__tests__/mediaStorage.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { writeFile, rm, mkdir } from "fs/promises";
import os from "os";
import {
  mealDir,
  mealPdfPath,
  mealThumbPath,
  hashFile,
  ensureMealDir,
} from "../services/mediaStorage.js";

describe("mediaStorage", () => {
  it("mealDir returns storage/meals/{id}", () => {
    expect(mealDir(42)).toMatch(/[\\/]storage[\\/]meals[\\/]42$/);
  });

  it("mealPdfPath returns source.pdf inside meal dir", () => {
    expect(mealPdfPath(42).endsWith(path.join("42", "source.pdf"))).toBe(true);
  });

  it("mealThumbPath returns thumb.jpg inside meal dir", () => {
    expect(mealThumbPath(42).endsWith(path.join("42", "thumb.jpg"))).toBe(true);
  });

  it("hashFile returns consistent sha256 for identical content", async () => {
    const tmp = path.join(os.tmpdir(), `amp-test-${Date.now()}.bin`);
    await writeFile(tmp, "hello world");
    const a = await hashFile(tmp);
    const b = await hashFile(tmp);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    await rm(tmp);
  });

  it("ensureMealDir creates the directory", async () => {
    const id = 999_900 + Math.floor(Math.random() * 100);
    const dir = await ensureMealDir(id);
    expect(dir).toBe(mealDir(id));
    // writing a file should succeed → dir exists
    await writeFile(path.join(dir, "probe.txt"), "ok");
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx vitest run src/__tests__/mediaStorage.test.ts
```
Expected: fails (module not found).

- [ ] **Step 3: Implement mediaStorage.ts**

Create `server/src/services/mediaStorage.ts`:

```typescript
import path from "path";
import { mkdir, createReadStream } from "fs";
import { mkdir as mkdirP } from "fs/promises";
import { createHash } from "crypto";

const STORAGE_ROOT = path.resolve(process.cwd(), "storage", "meals");

export function mealDir(mealId: number): string {
  return path.join(STORAGE_ROOT, String(mealId));
}

export function mealPdfPath(mealId: number): string {
  return path.join(mealDir(mealId), "source.pdf");
}

export function mealThumbPath(mealId: number): string {
  return path.join(mealDir(mealId), "thumb.jpg");
}

export async function ensureMealDir(mealId: number): Promise<string> {
  const dir = mealDir(mealId);
  await mkdirP(dir, { recursive: true });
  return dir;
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Relative path used in DB (pdfPath/imagePath columns). Always forward slashes. */
export function relStoragePath(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel.split(path.sep).join("/");
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd server && npx vitest run src/__tests__/mediaStorage.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mediaStorage.ts server/src/__tests__/mediaStorage.test.ts
git commit -m "feat(server): add mediaStorage helpers"
```

---

## Task 4: PDF extraction service

**Files:**
- Create: `server/src/services/pdfExtraction.ts`
- Create: `server/src/__tests__/pdfExtraction.test.ts`

- [ ] **Step 1: Write failing test for the size-gate helper**

Create `server/src/__tests__/pdfExtraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { passesSizeGate, parseImagesList } from "../services/pdfExtraction.js";

describe("pdfExtraction.passesSizeGate", () => {
  it("accepts a 400x300, 20KB image", () => {
    expect(passesSizeGate({ width: 400, height: 300, bytes: 20_480 })).toBe(true);
  });
  it("rejects under-minimum width", () => {
    expect(passesSizeGate({ width: 399, height: 300, bytes: 20_480 })).toBe(false);
  });
  it("rejects under-minimum bytes", () => {
    expect(passesSizeGate({ width: 800, height: 600, bytes: 10_000 })).toBe(false);
  });
  it("rejects absurd aspect ratio (> 4:1 or < 1:4)", () => {
    expect(passesSizeGate({ width: 2000, height: 300, bytes: 60_000 })).toBe(false);
    expect(passesSizeGate({ width: 300, height: 2000, bytes: 60_000 })).toBe(false);
  });
});

describe("pdfExtraction.parseImagesList", () => {
  it("parses pdfimages -list output and returns rows sorted by area descending", () => {
    const raw = [
      "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
      "--------------------------------------------------------------------------------------------",
      "   1     0 image     100   100  rgb     3   8  jpeg   no        12  0    96    96  3.5K 12%",
      "   1     1 image     800   600  rgb     3   8  jpeg   no        13  0    96    96  55K  12%",
      "   1     2 image     400   300  rgb     3   8  jpeg   no        14  0    96    96  22K  12%",
    ].join("\n");
    const rows = parseImagesList(raw);
    expect(rows[0].width).toBe(800);
    expect(rows[0].height).toBe(600);
    expect(rows[1].width).toBe(400);
    expect(rows[2].width).toBe(100);
  });

  it("returns empty array on empty output", () => {
    expect(parseImagesList("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd server && npx vitest run src/__tests__/pdfExtraction.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement pdfExtraction.ts**

Create `server/src/services/pdfExtraction.ts`:

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, copyFile, rename, readdir, stat, unlink } from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export interface ImageRow {
  width: number;
  height: number;
  bytes: number;   // parsed from "size" column (e.g. "22K" -> 22528)
  objectId: number;
  page: number;
  index: number;   // row index within pdfimages output, used to extract by -f/-l
}

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const MIN_BYTES = 20 * 1024;

export function passesSizeGate(img: Pick<ImageRow, "width" | "height" | "bytes">): boolean {
  if (img.width < MIN_WIDTH || img.height < MIN_HEIGHT) return false;
  if (img.bytes < MIN_BYTES) return false;
  const ratio = img.width / img.height;
  if (ratio > 4 || ratio < 0.25) return false;
  return true;
}

/** Parses the output of `pdfimages -list`, returning rows sorted largest-first by area. */
export function parseImagesList(raw: string): ImageRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => /^\s*\d/.test(l));
  const rows: ImageRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].trim().split(/\s+/);
    // Columns: page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
    if (cols.length < 14) continue;
    const page = Number(cols[0]);
    const width = Number(cols[3]);
    const height = Number(cols[4]);
    const objectId = Number(cols[10]);
    const sizeStr = cols[13]; // e.g. "22K", "1.1M"
    const bytes = parseSize(sizeStr);
    if (!width || !height) continue;
    rows.push({ width, height, bytes, objectId, page, index: i });
  }
  return rows.sort((a, b) => b.width * b.height - a.width * a.height);
}

function parseSize(s: string): number {
  const m = s.match(/^([\d.]+)([KMG]?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "K") return Math.round(n * 1024);
  if (unit === "M") return Math.round(n * 1024 * 1024);
  if (unit === "G") return Math.round(n * 1024 * 1024 * 1024);
  return Math.round(n);
}

export async function ensurePopplerAvailable(): Promise<{ pdfimages: boolean; pdftoppm: boolean }> {
  const check = async (bin: string) => {
    try {
      await execFileAsync(bin, ["-v"], { timeout: 5000 });
      return true;
    } catch {
      // pdfimages/pdftoppm print version to stderr and exit 99 on `-v` in some versions
      // so also try a help-style invocation
      try { await execFileAsync(bin, ["-h"], { timeout: 5000 }); return true; }
      catch { return false; }
    }
  };
  return { pdfimages: await check("pdfimages"), pdftoppm: await check("pdftoppm") };
}

/**
 * Cascading thumbnail extraction. Writes a JPEG to destJpgPath on success.
 * @returns the source tag, or null if no tier succeeded.
 */
export async function runThumbnailJob(
  pdfPath: string,
  destJpgPath: string,
): Promise<"embedded" | "rasterized" | null> {
  await mkdir(path.dirname(destJpgPath), { recursive: true });

  // Tier 1: pdfimages — pull out the largest embedded image that passes the size gate.
  try {
    const list = await execFileAsync("pdfimages", ["-list", pdfPath], { timeout: 30_000 });
    const rows = parseImagesList(list.stdout);
    const pick = rows.find(passesSizeGate);
    if (pick) {
      // Extract only page `pick.page`, writing JPEG-native where possible.
      const tmpPrefix = path.join(os.tmpdir(), `amp-img-${Date.now()}`);
      await execFileAsync("pdfimages", [
        "-j",                  // write JPEG where the PDF stream is already JPEG (no re-encode)
        "-f", String(pick.page),
        "-l", String(pick.page),
        pdfPath,
        tmpPrefix,
      ], { timeout: 30_000 });

      // pdfimages will produce files like tmpPrefix-000.jpg, tmpPrefix-001.ppm, etc.
      // Pick the largest .jpg (or convert the largest .ppm via pdftoppm -jpeg fallback).
      const candidates = (await readdir(path.dirname(tmpPrefix)))
        .filter((f) => f.startsWith(path.basename(tmpPrefix)));
      let chosen: { file: string; size: number } | null = null;
      for (const f of candidates) {
        const abs = path.join(path.dirname(tmpPrefix), f);
        const st = await stat(abs);
        if (!chosen || st.size > chosen.size) chosen = { file: abs, size: st.size };
      }
      if (chosen && chosen.file.endsWith(".jpg")) {
        await rename(chosen.file, destJpgPath);
        // cleanup other candidates
        for (const f of candidates) {
          const abs = path.join(path.dirname(tmpPrefix), f);
          try { await unlink(abs); } catch { /* may already be moved */ }
        }
        return "embedded";
      }
      // Not a jpg — clean up and fall through to rasterization
      for (const f of candidates) {
        try { await unlink(path.join(path.dirname(tmpPrefix), f)); } catch {}
      }
    }
  } catch (e) {
    // Fall through to rasterization
  }

  // Tier 2: pdftoppm — rasterize page 1 to JPEG at 120 dpi.
  try {
    const tmpPrefix = path.join(os.tmpdir(), `amp-page-${Date.now()}`);
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-r", "120",
      "-f", "1", "-l", "1",
      pdfPath,
      tmpPrefix,
    ], { timeout: 60_000 });
    // pdftoppm outputs tmpPrefix-1.jpg
    const out = `${tmpPrefix}-1.jpg`;
    await rename(out, destJpgPath);
    return "rasterized";
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run unit tests to verify pass**

```bash
cd server && npx vitest run src/__tests__/pdfExtraction.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Smoke test against a real PDF on the server**

From dev machine:
```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && \
  npx tsx -e 'import { runThumbnailJob } from \"./src/services/pdfExtraction.js\"; const pdf = \"/home/swizz/projects/AgenticMealPlanner/server/uploads/1775798603205-creamy_dijon_dill_chicken.pdf\"; const out = \"/tmp/amp-smoke-test.jpg\"; runThumbnailJob(pdf, out).then(s => console.log(\"source:\", s)).catch(e => { console.error(e); process.exit(1); });' && \
  ls -la /tmp/amp-smoke-test.jpg && file /tmp/amp-smoke-test.jpg"
```
Expected: prints `source: embedded` (or `rasterized`), file exists, `file` says `JPEG image data`.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/pdfExtraction.ts server/src/__tests__/pdfExtraction.test.ts
git commit -m "feat(server): add PDF thumbnail extraction (pdfimages → pdftoppm)"
```

---

## Task 5: Media route

**Files:**
- Create: `server/src/routes/media.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create the route file**

Create `server/src/routes/media.ts`:

```typescript
import { Router } from "express";
import path from "path";
import { access } from "fs/promises";
import { constants as FS } from "fs";
import { mealPdfPath, mealThumbPath } from "../services/mediaStorage.js";

const router = Router();

router.get("/meals/:id/thumb.jpg", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).end();
  const p = mealThumbPath(id);
  try { await access(p, FS.R_OK); } catch { return res.status(404).end(); }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.resolve(p));
});

router.get("/meals/:id/source.pdf", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).end();
  const p = mealPdfPath(id);
  try { await access(p, FS.R_OK); } catch { return res.status(404).end(); }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="recipe-${id}.pdf"`);
  res.sendFile(path.resolve(p));
});

export default router;
```

- [ ] **Step 2: Mount the router in index.ts**

Open `server/src/index.ts`. Find the section where other routers are mounted (e.g. `app.use("/api/meals", …)`). Add, near the other mounts:

```typescript
import mediaRouter from "./routes/media.js";
import { ensurePopplerAvailable } from "./services/pdfExtraction.js";

app.use("/media", mediaRouter);

ensurePopplerAvailable().then(({ pdfimages, pdftoppm }) => {
  if (!pdfimages || !pdftoppm) {
    console.warn(`[boot] poppler-utils missing: pdfimages=${pdfimages} pdftoppm=${pdftoppm}. Thumbnail extraction disabled.`);
  }
});
```

- [ ] **Step 3: Smoke test**

Commit so far, push, pull on server, then:
```bash
ssh meal-server "curl -sI http://localhost:3100/media/meals/999/thumb.jpg"
```
Expected: `HTTP/1.1 404 Not Found` (meal doesn't exist — correct behavior).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/media.ts server/src/index.ts
git commit -m "feat(server): add /media/meals/:id/{thumb.jpg,source.pdf} route"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 6: Import sessions service

**Files:**
- Create: `server/src/services/importSessions.ts`
- Create: `server/src/__tests__/importSessions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/__tests__/importSessions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stashImportPdf, popImportPdf, clearExpired } from "../services/importSessions.js";

describe("importSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stash returns a session id and pop returns the path", () => {
    const id = stashImportPdf("/tmp/abc.pdf");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(popImportPdf(id)).toBe("/tmp/abc.pdf");
  });

  it("pop returns null for unknown id", () => {
    expect(popImportPdf("does-not-exist")).toBeNull();
  });

  it("pop is single-use", () => {
    const id = stashImportPdf("/tmp/x.pdf");
    expect(popImportPdf(id)).toBe("/tmp/x.pdf");
    expect(popImportPdf(id)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const id = stashImportPdf("/tmp/y.pdf");
    vi.advanceTimersByTime(16 * 60 * 1000);
    clearExpired();
    expect(popImportPdf(id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && npx vitest run src/__tests__/importSessions.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement importSessions.ts**

Create `server/src/services/importSessions.ts`:

```typescript
import { randomUUID } from "crypto";

interface Entry {
  pdfPath: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, Entry>();

export function stashImportPdf(pdfPath: string): string {
  const id = randomUUID();
  store.set(id, { pdfPath, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function popImportPdf(id: string): string | null {
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  if (entry.expiresAt < Date.now()) return null;
  return entry.pdfPath;
}

export function clearExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

// Periodic sweep (once per 5 min) so the map doesn't accumulate ghosts.
setInterval(clearExpired, 5 * 60 * 1000).unref?.();
```

- [ ] **Step 4: Verify tests pass**

```bash
cd server && npx vitest run src/__tests__/importSessions.test.ts
```
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/importSessions.ts server/src/__tests__/importSessions.test.ts
git commit -m "feat(server): add importSessions TTL store for import-to-create hand-off"
```

---

## Task 7: Extend meals router with photo upload

**Files:**
- Modify: `server/src/middleware/upload.ts`
- Modify: `server/src/routes/meals.ts`
- Modify: `server/src/services/mealService.ts`

- [ ] **Step 1: Add image-only multer instance**

Open `server/src/middleware/upload.ts`. Read the current file. Add a second export at the bottom:

```typescript
export const uploadImage = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG/PNG/WebP images allowed"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadPdfOnly = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (_, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files allowed"));
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});
```

- [ ] **Step 2: Add replacePhoto service function**

Open `server/src/services/mealService.ts`. Append:

```typescript
import { copyFile, unlink } from "fs/promises";
import { ensureMealDir, mealThumbPath, relStoragePath } from "./mediaStorage.js";

export async function replaceMealPhoto(mealId: number, tmpPath: string) {
  await ensureMealDir(mealId);
  const dest = mealThumbPath(mealId);
  await copyFile(tmpPath, dest);
  try { await unlink(tmpPath); } catch {}
  return prisma.meal.update({
    where: { id: mealId },
    data: { imagePath: relStoragePath(dest), imageSource: "manual" },
  });
}
```

(If `prisma` isn't already imported at the top, add `import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient();` consistent with the file's existing style.)

- [ ] **Step 3: Wire up the route**

Open `server/src/routes/meals.ts`. Add near the existing routes:

```typescript
import { uploadImage } from "../middleware/upload.js";
import { replaceMealPhoto } from "../services/mealService.js";

router.post("/:id/photo", uploadImage.single("file"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "missing file" });
    const meal = await replaceMealPhoto(id, req.file.path);
    res.json(meal);
  } catch (e) { next(e); }
});
```

- [ ] **Step 4: Smoke test**

Commit, push, pull on server, then:
```bash
# Pick a small test jpg
ssh meal-server "echo test > /tmp/bad.txt && curl -sS -X POST -F file=@/tmp/bad.txt http://localhost:3100/api/meals/1/photo"
```
Expected: HTTP error about MIME ("Only JPEG/PNG/WebP images allowed").

```bash
ssh meal-server "curl -sS -F file=@/some/real/image.jpg http://localhost:3100/api/meals/1/photo | python3 -m json.tool | grep -E 'imagePath|imageSource'"
```
Expected: `"imagePath": "storage/meals/1/thumb.jpg"`, `"imageSource": "manual"`.

```bash
ssh meal-server "curl -sI http://localhost:3100/media/meals/1/thumb.jpg"
```
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/upload.ts server/src/routes/meals.ts server/src/services/mealService.ts
git commit -m "feat(server): POST /api/meals/:id/photo (manual photo upload)"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 8: PDF upload endpoint + post-upload extraction

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add uploadMealPdf service**

Append to `server/src/services/mealService.ts`:

```typescript
import { runThumbnailJob } from "./pdfExtraction.js";
import { mealPdfPath, mealThumbPath } from "./mediaStorage.js";

export async function uploadMealPdf(mealId: number, tmpPath: string) {
  await ensureMealDir(mealId);
  const destPdf = mealPdfPath(mealId);
  await copyFile(tmpPath, destPdf);
  try { await unlink(tmpPath); } catch {}

  const meal = await prisma.meal.findUnique({ where: { id: mealId } });
  const keepManual = meal?.imageSource === "manual";

  let source: "embedded" | "rasterized" | null = null;
  if (!keepManual) {
    source = await runThumbnailJob(destPdf, mealThumbPath(mealId));
  }

  return prisma.meal.update({
    where: { id: mealId },
    data: {
      pdfPath: relStoragePath(destPdf),
      ...(keepManual ? {} : {
        imagePath: source ? relStoragePath(mealThumbPath(mealId)) : null,
        imageSource: source,
      }),
    },
  });
}
```

- [ ] **Step 2: Wire the route**

Append to `server/src/routes/meals.ts`:

```typescript
import { uploadPdfOnly } from "../middleware/upload.js";
import { uploadMealPdf } from "../services/mealService.js";

router.post("/:id/pdf", uploadPdfOnly.single("file"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "missing file" });
    const meal = await uploadMealPdf(id, req.file.path);
    res.json(meal);
  } catch (e) { next(e); }
});
```

- [ ] **Step 3: Smoke test**

Commit, push, pull, then:
```bash
ssh meal-server "curl -sS -F file=@/home/swizz/projects/AgenticMealPlanner/server/uploads/1775798603205-creamy_dijon_dill_chicken.pdf http://localhost:3100/api/meals/2/pdf | python3 -m json.tool | grep -E 'pdfPath|imagePath|imageSource'"
```
Expected: pdfPath set, imagePath set (unless meal 2 was manual), imageSource = embedded/rasterized.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(server): POST /api/meals/:id/pdf (upload + auto-extract)"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 9: Re-run extraction endpoint

**Files:**
- Modify: `server/src/services/mealService.ts`
- Modify: `server/src/routes/meals.ts`

- [ ] **Step 1: Add extractMealThumbnail service**

Append to `server/src/services/mealService.ts`:

```typescript
export async function extractMealThumbnail(mealId: number, force = false) {
  const meal = await prisma.meal.findUnique({ where: { id: mealId } });
  if (!meal) throw Object.assign(new Error("meal not found"), { status: 404 });
  if (!meal.pdfPath) throw Object.assign(new Error("no PDF for this meal"), { status: 409 });
  if (meal.imageSource === "manual" && !force) {
    throw Object.assign(new Error("photo is manual; pass force=true to overwrite"), { status: 409 });
  }
  const pdfAbs = path.resolve(process.cwd(), meal.pdfPath);
  const thumbAbs = mealThumbPath(mealId);
  const source = await runThumbnailJob(pdfAbs, thumbAbs);
  return prisma.meal.update({
    where: { id: mealId },
    data: { imagePath: source ? relStoragePath(thumbAbs) : null, imageSource: source },
  });
}
```

Add `import path from "path";` at the top if not already present.

- [ ] **Step 2: Wire the route**

Append to `server/src/routes/meals.ts`:

```typescript
import { extractMealThumbnail } from "../services/mealService.js";

router.post("/:id/extract-thumbnail", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const force = req.query.force === "true";
    const meal = await extractMealThumbnail(id, force);
    res.json(meal);
  } catch (e: any) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});
```

- [ ] **Step 3: Smoke test**

```bash
# On a meal that has a pdfPath
ssh meal-server "curl -sS -X POST http://localhost:3100/api/meals/2/extract-thumbnail | python3 -m json.tool | grep -E 'imagePath|imageSource'"
```
Expected: imagePath + imageSource present.

```bash
# On a meal without pdfPath
ssh meal-server "curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3100/api/meals/3/extract-thumbnail"
```
Expected: `409`.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/mealService.ts server/src/routes/meals.ts
git commit -m "feat(server): POST /api/meals/:id/extract-thumbnail"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 10: Import-to-create session hand-off

**Files:**
- Modify: `server/src/routes/meals.ts` (the existing `/import` + `POST /`)
- Modify: `server/src/services/mealService.ts`

- [ ] **Step 1: Update /import to stash + return session id**

Open `server/src/routes/meals.ts`. Find the existing `/import` handler — do NOT rewrite its parse + ingredient-map logic; leave all existing computation intact. Make two minimal edits:

1. At the top of the file, add:
```typescript
import { stashImportPdf, popImportPdf } from "../services/importSessions.js";
```

2. Inside the handler, right before the existing `res.json(...)` call, stash the path:
```typescript
const importSessionId = stashImportPdf(req.file.path);
```
Then add `importSessionId` as a new field on the response object. For example, if the current response is `{ parsed, ingredientMap }`, change it to `{ parsed, ingredientMap, importSessionId }`.

- [ ] **Step 2: Update POST / to consume session id on create**

Still in `server/src/routes/meals.ts`, in the `POST /` handler (creating a meal), after the meal row is inserted, add:

```typescript
if (req.body.importSessionId) {
  const tmpPdf = popImportPdf(req.body.importSessionId);
  if (tmpPdf) {
    // fire-and-forget; do not block the response
    uploadMealPdf(meal.id, tmpPdf).catch((err) =>
      console.error("[import→create] uploadMealPdf failed", meal.id, err)
    );
  }
}
```

- [ ] **Step 3: Client side — thread importSessionId through**

Open `client/src/pages/RecipeImport.tsx`. Find the `importRecipe` call site. The `importRecipe` API wrapper returns the response; store `importSessionId` in component state alongside `parsed`. Pass it into `handleSave`.

Edit `client/src/api/meals.ts` `importRecipe` to return the full response (it already does). Then in `handleSave`:
```typescript
const data = {
  ...formData,
  source: "hello_fresh",
  importSessionId,
  ingredients: /* unchanged */,
};
await createMeal(data);
```

(Store `importSessionId` from `result` alongside `ingredientMap` in the RecipeImport state.)

- [ ] **Step 4: Smoke test end-to-end**

1. Go to `/recipes/import` in the browser.
2. Upload a HelloFresh PDF.
3. Wait for parse, confirm, click Save.
4. Navigate to the new meal on the Recipes page.
5. Within ~1 second, the card should have a food photo.
6. `curl -sI http://localhost:3100/media/meals/<new-id>/thumb.jpg` should return 200.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/meals.ts client/src/pages/RecipeImport.tsx client/src/api/meals.ts
git commit -m "feat: thread import tmp PDF through to created Meal via session id"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 11: Backfill script

**Files:**
- Modify: `server/package.json` (add `fuse.js`)
- Create: `server/src/scripts/backfill-pdfs.ts`

- [ ] **Step 1: Add fuse.js dependency**

On dev machine:
```bash
cd server && npm install fuse.js
```

- [ ] **Step 2: Write the script**

Create `server/src/scripts/backfill-pdfs.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import { readdir, copyFile, stat } from "fs/promises";
import path from "path";
import Fuse from "fuse.js";
import { hashFile, ensureMealDir, mealPdfPath, mealThumbPath, relStoragePath } from "../services/mediaStorage.js";
import { runThumbnailJob } from "../services/pdfExtraction.js";

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  minScore: number;
  forcePairs: Map<string, number>; // filename → mealId
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { dryRun: false, minScore: 0.4, forcePairs: new Map() };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--min-score=")) args.minScore = Number(a.split("=")[1]);
    else if (a.startsWith("--force=")) {
      const pair = a.split("=")[1];
      const [name, id] = pair.split(":");
      if (name && id) args.forcePairs.set(name, Number(id));
    }
  }
  return args;
}

function cleanFilename(f: string): string {
  // Strip leading timestamp (e.g. "1775798603205-")
  const withoutTs = f.replace(/^\d{10,}-/, "");
  // Strip extension, replace underscores with spaces
  return withoutTs.replace(/\.pdf$/i, "").replace(/_/g, " ").trim();
}

async function main() {
  const args = parseArgs();
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const files = (await readdir(uploadsDir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`Reading ${uploadsDir} .......... ${files.length} PDFs`);

  const seenHash = new Map<string, string>(); // hash → first filename
  const unique: string[] = [];
  for (const f of files) {
    const abs = path.join(uploadsDir, f);
    const h = await hashFile(abs);
    if (seenHash.has(h)) continue;
    seenHash.set(h, f);
    unique.push(f);
  }
  console.log(`SHA-256 dedupe ............... ${unique.length} unique`);

  const meals = await prisma.meal.findMany({ select: { id: true, name: true, pdfPath: true } });
  console.log(`Loading meals ................ ${meals.length} meals`);

  const fuse = new Fuse(meals, { keys: ["name"], threshold: args.minScore, includeScore: true });

  const matched: { file: string; mealId: number; mealName: string; score: number }[] = [];
  const unmatched: { file: string; best?: { id: number; name: string; score: number } }[] = [];

  for (const file of unique) {
    const override = args.forcePairs.get(file);
    if (override) {
      const m = meals.find((x) => x.id === override);
      if (!m) { unmatched.push({ file }); continue; }
      matched.push({ file, mealId: m.id, mealName: m.name, score: 0 });
      continue;
    }
    const query = cleanFilename(file);
    const hits = fuse.search(query);
    const top = hits[0];
    if (top && top.score! <= args.minScore) {
      if (top.item.pdfPath) {
        // already has a PDF; skip silently to avoid clobber
        continue;
      }
      matched.push({ file, mealId: top.item.id, mealName: top.item.name, score: top.score! });
    } else {
      const best = hits[0] ? { id: hits[0].item.id, name: hits[0].item.name, score: hits[0].score! } : undefined;
      unmatched.push({ file, best });
    }
  }

  console.log("\n=== Matches ===");
  for (const m of matched) {
    console.log(`  ${m.file} → "${m.mealName}" (meal ${m.mealId}, score ${m.score.toFixed(2)})`);
  }
  console.log("\n=== Unmatched ===");
  for (const u of unmatched) {
    const tail = u.best ? ` (best: "${u.best.name}" score ${u.best.score.toFixed(2)})` : "";
    console.log(`  ${u.file}${tail}`);
  }

  if (args.dryRun) {
    console.log(`\n[dry-run] ${matched.length} would be matched, ${unmatched.length} unmatched.`);
    await prisma.$disconnect();
    return;
  }

  console.log("\n=== Applying ===");
  for (const m of matched) {
    await ensureMealDir(m.mealId);
    const src = path.join(uploadsDir, m.file);
    const destPdf = mealPdfPath(m.mealId);
    await copyFile(src, destPdf);
    const source = await runThumbnailJob(destPdf, mealThumbPath(m.mealId));
    await prisma.meal.update({
      where: { id: m.mealId },
      data: {
        pdfPath: relStoragePath(destPdf),
        imagePath: source ? relStoragePath(mealThumbPath(m.mealId)) : null,
        imageSource: source,
      },
    });
    console.log(`  ✓ ${m.mealName} (source=${source ?? "none"})`);
  }

  console.log(`\nDone. Applied ${matched.length}. Unmatched ${unmatched.length}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 3: Dry-run on server**

Commit + push, pull, then:
```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && npx tsx src/scripts/backfill-pdfs.ts --dry-run"
```
Expected: prints a list of matches + unmatched PDFs. Eyeball it.

- [ ] **Step 4: Tune score threshold if needed**

If >5 unmatched but obviously-similar, re-run with `--min-score=0.5`:
```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && npx tsx src/scripts/backfill-pdfs.ts --dry-run --min-score=0.5"
```

- [ ] **Step 5: Commit the script (no-apply yet)**

```bash
git add server/src/scripts/backfill-pdfs.ts server/package.json server/package-lock.json
git commit -m "feat(server): backfill-pdfs script (dry-run capable)"
git push origin master
```

(The actual apply is Task 14, after the UI is in place.)

---

## Task 12: Client API wrappers + Meal type

**Files:**
- Modify: `client/src/api/meals.ts`

- [ ] **Step 1: Extend Meal type**

Open `client/src/api/meals.ts`. Find the `Meal` interface. Add three fields:
```typescript
  pdfPath: string | null;
  imagePath: string | null;
  imageSource: "embedded" | "rasterized" | "manual" | null;
```

- [ ] **Step 2: Update importRecipe return type**

The current `importRecipe` returns `res.json()` typed as `any`. Make it explicit:
```typescript
export interface ImportRecipeResult {
  parsed: any;
  ingredientMap: Record<string, number>;
  importSessionId: string;
}

export async function importRecipe(file: File): Promise<ImportRecipeResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/meals/import", { method: "POST", body: form });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}
```

- [ ] **Step 3: Add upload helpers**

Append to the same file:
```typescript
export async function uploadMealPhoto(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/photo`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function uploadMealPdf(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/pdf`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function extractMealThumbnail(id: number, force = false): Promise<Meal> {
  const q = force ? "?force=true" : "";
  const res = await fetch(`/api/meals/${id}/extract-thumbnail${q}`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "extraction failed");
  return res.json();
}
```

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/meals.ts
git commit -m "feat(client): Meal.imagePath/pdfPath, upload+extract API helpers"
```

---

## Task 13: MealCard + Dashboard fall back to imagePath

**Files:**
- Modify: `client/src/components/MealCard.tsx`
- Modify: `client/src/pages/Dashboard.tsx`

- [ ] **Step 1: MealCard: use imagePath with onError fallback**

Open `client/src/components/MealCard.tsx`. Replace the `{photos && <PhotoTile ... />}` block near the top of the card with:

```tsx
{photos && (
  meal.imagePath ? (
    <MealCardImage mealId={meal.id} alt={meal.name} />
  ) : (
    <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="16 / 10" round={0} />
  )
)}
```

At the bottom of the file (outside the default export), add:

```tsx
import { useState } from "react";

function MealCardImage({ mealId, alt }: { mealId: number; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <PhotoTile tone="warm-amber" label={alt.toLowerCase()} aspect="16 / 10" round={0} />;
  }
  return (
    <img
      src={`/media/meals/${mealId}/thumb.jpg`}
      alt={alt}
      loading="lazy"
      className="w-full aspect-[16/10] object-cover block"
      onError={() => setFailed(true)}
    />
  );
}
```

(Move `useState` into the existing React import if present.)

- [ ] **Step 2: Dashboard hero + other-meals rows**

Open `client/src/pages/Dashboard.tsx`. Find the `<PhotoTile>` use inside the tonight's-dinner hero (inside the `min-h-[200px] lg:min-h-[320px]` wrapper). Replace that div's body with:

```tsx
{tonight.meal.imagePath ? (
  <img
    src={`/media/meals/${tonight.meal.id}/thumb.jpg`}
    alt={tonight.meal.name}
    className="w-full h-full object-cover"
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
  />
) : (
  <PhotoTile
    tone={toneForMeal(tonight.meal)}
    label={`tonight — ${tonight.meal.name.toLowerCase()}`}
    aspect={null}
    round={0}
  />
)}
```

For the other-meals row (the `<div className="w-[64px] sm:w-[72px] flex-shrink-0">` wrapping a `<PhotoTile>`), replace with a similar pattern using `w-full h-full object-cover` inside a square wrapper. Concretely:

```tsx
<div className="w-[64px] sm:w-[72px] flex-shrink-0 aspect-square rounded-[10px] overflow-hidden">
  {pm.meal.imagePath ? (
    <img
      src={`/media/meals/${pm.meal.id}/thumb.jpg`}
      alt={pm.meal.name}
      className="w-full h-full object-cover"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  ) : (
    <PhotoTile tone={toneForMeal(pm.meal)} aspect="1 / 1" round={10} compact />
  )}
</div>
```

- [ ] **Step 3: Typecheck + visual verify**

```bash
cd client && npx tsc --noEmit
```

Push, pull on server, open http://100.119.100.39:5173/ in a browser — meals with `imagePath` show real photos, the rest show SVG placeholders. No broken-image icons.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MealCard.tsx client/src/pages/Dashboard.tsx
git commit -m "feat(client): MealCard + Dashboard prefer imagePath, fall back to PhotoTile"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 14: RecipeDetail action row + real PDF link

**Files:**
- Modify: `client/src/pages/RecipeDetail.tsx`

- [ ] **Step 1: Replace the PDF button behavior**

Open `client/src/pages/RecipeDetail.tsx`. Find the `hasPdf` variable and the "Original PDF" `<Button>` in the main action row. Replace both with a computed `hasPdf = !!meal.pdfPath`:

```tsx
const hasPdf = !!meal.pdfPath;
```

And change the button handler:

```tsx
{hasPdf && (
  <Button
    variant="ghost"
    icon={FileText}
    onClick={() => window.open(`/media/meals/${meal.id}/source.pdf`, "_blank", "noopener,noreferrer")}
  >
    Original PDF
  </Button>
)}
```

Remove the `{pdfOpen && hasPdf && <PdfViewer ...} block and the `PdfViewer`/`RecipeCardPaper` functions — they're no longer used. Also remove the `pdfOpen` state and the `PHOTO_TONES` import (no longer needed).

- [ ] **Step 2: Add the override action row**

Add, just below the existing action row (the one with Add to plan / Scale servings / Original PDF), a new row:

```tsx
<MealAssetActions meal={meal} onUpdated={setMeal} />
```

At the bottom of the file, add:

```tsx
import { Camera, FileUp, RefreshCw } from "lucide-react";
import { uploadMealPhoto, uploadMealPdf, extractMealThumbnail } from "../api/meals";

function MealAssetActions({ meal, onUpdated }: { meal: Meal; onUpdated: (m: Meal) => void }) {
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"photo" | "pdf" | "extract" | null>(null);

  const guardAsync = async (label: typeof busy, fn: () => Promise<Meal>) => {
    setBusy(label); try { onUpdated(await fn()); } catch (e: any) { alert(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="flex gap-2 flex-wrap mt-2">
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) guardAsync("photo", () => uploadMealPhoto(meal.id, f)); }} />
      <Button variant="ghost" size="sm" icon={Camera}
        disabled={busy !== null}
        onClick={() => photoInput.current?.click()}>
        {busy === "photo" ? "Uploading…" : "Replace photo"}
      </Button>

      {!meal.pdfPath && (
        <>
          <input ref={pdfInput} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) guardAsync("pdf", () => uploadMealPdf(meal.id, f)); }} />
          <Button variant="ghost" size="sm" icon={FileUp}
            disabled={busy !== null}
            onClick={() => pdfInput.current?.click()}>
            {busy === "pdf" ? "Uploading…" : "Upload PDF"}
          </Button>
        </>
      )}

      {meal.pdfPath && (
        <Button variant="ghost" size="sm" icon={RefreshCw}
          disabled={busy !== null}
          onClick={async () => {
            if (meal.imageSource === "manual" && !window.confirm("The current photo is manual. Overwrite?")) return;
            const force = meal.imageSource === "manual";
            guardAsync("extract", () => extractMealThumbnail(meal.id, force));
          }}>
          {busy === "extract" ? "Re-extracting…" : "Re-run extraction"}
        </Button>
      )}
    </div>
  );
}
```

Add `useRef, useState` to the React import at the top if not present.

- [ ] **Step 3: Update the main photo in detail view too**

In RecipeDetail, the detail view's `<PhotoTile tone={tone} label={...} aspect="4 / 5" round={18} />` should also honor `imagePath`. Wrap it:

```tsx
{meal.imagePath ? (
  <img
    src={`/media/meals/${meal.id}/thumb.jpg?v=${meal.updatedAt ?? Date.now()}`}
    alt={meal.name}
    className="w-full aspect-[4/5] object-cover rounded-[18px]"
  />
) : (
  <PhotoTile tone={tone} label={meal.name.toLowerCase()} aspect="4 / 5" round={18} />
)}
```

(The `?v=` query-string bust is so Re-run extraction immediately reflects visually. If `updatedAt` isn't in the Meal type, add it via `updatedAt?: string`.)

- [ ] **Step 4: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: UI smoke test**

In the browser: open a recipe detail page, click Replace photo, pick any JPEG → image updates within ~1s. Click Original PDF on a meal with a PDF → opens in new tab. Click Upload PDF on a meal without one → modal closes, photo appears shortly after.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RecipeDetail.tsx
git commit -m "feat(client): RecipeDetail asset actions + real PDF link"
git push origin master
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner && git pull --ff-only"
```

---

## Task 15: Run the backfill

**Files:** none (one-shot op)

- [ ] **Step 1: Dry-run on server**

```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && npx tsx src/scripts/backfill-pdfs.ts --dry-run"
```

- [ ] **Step 2: Review the matched/unmatched lists**

Read output. For each unmatched-but-obvious pair, note the filename and the correct meal id.

- [ ] **Step 3: Run for real, with any --force overrides**

```bash
ssh meal-server "cd /home/swizz/projects/AgenticMealPlanner/server && npx tsx src/scripts/backfill-pdfs.ts --force=filename1.pdf:7 --force=filename2.pdf:12"
```
(Omit `--force=` args if all matches were clean.)

Expected: "Done. Applied N. Unmatched M."

- [ ] **Step 4: Spot-check in the UI**

Open http://100.119.100.39:5173/recipes — newly-matched recipes should show real photos.

- [ ] **Step 5: Clean up uploads dir (optional)**

Only after spot-checking looks good:
```bash
ssh meal-server "mv /home/swizz/projects/AgenticMealPlanner/server/uploads /home/swizz/projects/AgenticMealPlanner/server/uploads.old"
```

---

## Self-Review

**Spec coverage:**
- PDF + thumbnail persistence → Tasks 2, 7, 8
- Cascading extraction → Task 4
- Media serving → Task 5
- Manual override (photo / pdf / re-run) → Tasks 7, 8, 9 + Task 14 UI
- Import-to-create hand-off → Task 10
- Backfill with fuzzy match + dedupe → Tasks 11, 15
- Client card + dashboard fallback → Task 13
- Detail page "Original PDF" opens real PDF → Task 14
- Poppler install + gitignore → Task 1

**No spec requirements are uncovered.**

**Type consistency:**
- `pdfPath`, `imagePath`, `imageSource` names used identically in schema (Task 2), services (Tasks 3, 7, 8, 9), client type (Task 12), and client components (Tasks 13, 14).
- Extraction source tags `"embedded" | "rasterized" | "manual" | null` consistent across server and client.
- `importSessionId` spelled identically in Tasks 6, 10, 12.

**Placeholder scan:** no "TBD", no "fill in", no "similar to Task N without code" left. Every code block is complete.
