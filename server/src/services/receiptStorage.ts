import path from "path";
import { mkdir, copyFile, unlink } from "fs/promises";

const STORAGE_ROOT = path.resolve(process.cwd(), "storage", "receipts");

export function receiptDir(receiptId: number): string {
  return path.join(STORAGE_ROOT, String(receiptId));
}

export async function ensureReceiptDir(receiptId: number): Promise<string> {
  const dir = receiptDir(receiptId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function moveSourceIntoReceipt(
  receiptId: number,
  uploadPath: string,
): Promise<string> {
  const ext = path.extname(uploadPath).toLowerCase() || "";
  const dir = await ensureReceiptDir(receiptId);
  const dest = path.join(dir, `source${ext}`);
  await copyFile(uploadPath, dest);
  await unlink(uploadPath).catch(() => undefined);
  // Relative path for DB storage, forward slashes always.
  return path.relative(process.cwd(), dest).split(path.sep).join("/");
}
