import path from "path";
import { mkdir as mkdirP } from "fs/promises";
import { createReadStream } from "fs";
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
