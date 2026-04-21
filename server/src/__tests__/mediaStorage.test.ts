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
