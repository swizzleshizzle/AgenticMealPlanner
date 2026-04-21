import { describe, it, expect } from "vitest";
import path from "path";
import { writeFile, rm, mkdir } from "fs/promises";
import os from "os";
import {
  mealDir,
  mealPdfPath,
  mealThumbPath,
  hashFile,
  ensureMealDir,
  relStoragePath,
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
    try {
      const a = await hashFile(tmp);
      const b = await hashFile(tmp);
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    } finally {
      await rm(tmp);
    }
  });

  it("ensureMealDir creates the directory", async () => {
    const id = 999_900 + Math.floor(Math.random() * 100);
    const dir = await ensureMealDir(id);
    try {
      expect(dir).toBe(mealDir(id));
      await writeFile(path.join(dir, "probe.txt"), "ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("relStoragePath returns forward-slash-only relative path", () => {
    const abs = path.join(process.cwd(), "storage", "meals", "7", "thumb.jpg");
    const rel = relStoragePath(abs);
    expect(rel).toBe("storage/meals/7/thumb.jpg");
    expect(rel).not.toContain("\\");
  });
});
