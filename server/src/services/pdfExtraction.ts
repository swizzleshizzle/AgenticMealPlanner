import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, rename, readdir, stat, unlink } from "fs/promises";
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
    if (cols[2] !== "image") continue;
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
      const tmpDir = path.dirname(tmpPrefix);
      const tmpBase = path.basename(tmpPrefix);
      let produced: string[] = [];
      try {
        await execFileAsync("pdfimages", [
          "-j",                  // write JPEG where the PDF stream is already JPEG (no re-encode)
          "-f", String(pick.page),
          "-l", String(pick.page),
          pdfPath,
          tmpPrefix,
        ], { timeout: 30_000 });

        // pdfimages will produce files like tmpPrefix-000.jpg, tmpPrefix-001.ppm, etc.
        // Pick the largest .jpg (or convert the largest .ppm via pdftoppm -jpeg fallback).
        produced = (await readdir(tmpDir)).filter((f) => f.startsWith(tmpBase));
        let chosen: { file: string; size: number } | null = null;
        for (const f of produced) {
          const abs = path.join(tmpDir, f);
          const st = await stat(abs);
          if (!chosen || st.size > chosen.size) chosen = { file: abs, size: st.size };
        }
        if (chosen && chosen.file.endsWith(".jpg")) {
          await rename(chosen.file, destJpgPath);
          // Remove the chosen file from `produced` so the finally block doesn't try to delete it.
          produced = produced.filter((f) => path.join(tmpDir, f) !== chosen!.file);
          return "embedded";
        }
        // Not a jpg → fall through to Tier 2
      } finally {
        for (const f of produced) {
          try { await unlink(path.join(tmpDir, f)); } catch { /* already gone */ }
        }
      }
    }
  } catch (e) {
    // Log and fall through to Tier 2.
    console.warn(`[pdfExtraction] Tier 1 (pdfimages) failed for ${pdfPath}:`, (e as Error).message);
  }

  // Tier 2: pdftoppm — rasterize page 1 to JPEG at 120 dpi.
  try {
    const tmpPrefix = path.join(os.tmpdir(), `amp-page-${Date.now()}`);
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-singlefile",
      "-r", "120",
      pdfPath,
      tmpPrefix,
    ], { timeout: 60_000 });
    // -singlefile emits `{tmpPrefix}.jpg` exactly.
    const out = `${tmpPrefix}.jpg`;
    await rename(out, destJpgPath);
    return "rasterized";
  } catch (e) {
    console.warn(`[pdfExtraction] Tier 2 (pdftoppm) failed for ${pdfPath}:`, (e as Error).message);
    return null;
  }
}
