import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import {
  planTiles,
  tileImageIfTall,
  TILE_ASPECT_THRESHOLD,
  TILE_OVERLAP_PX,
} from "../services/imageTiling.js";

describe("planTiles", () => {
  it("returns no tiles for a normal-aspect image", () => {
    expect(planTiles(1000, 1500)).toEqual([]);
  });

  it("returns no tiles for a square image", () => {
    expect(planTiles(800, 800)).toEqual([]);
  });

  it("tiles a tall receipt screenshot into overlapping slices covering full height", () => {
    const width = 1149;
    const height = 9678;
    const tiles = planTiles(width, height);

    expect(tiles.length).toBeGreaterThan(1);
    // First tile starts at the top, last tile reaches the bottom.
    expect(tiles[0].top).toBe(0);
    const last = tiles[tiles.length - 1];
    expect(last.top + last.height).toBe(height);
    // Consecutive tiles overlap so no line item is lost at a seam.
    for (let i = 1; i < tiles.length; i++) {
      const prevBottom = tiles[i - 1].top + tiles[i - 1].height;
      expect(tiles[i].top).toBeLessThanOrEqual(prevBottom - TILE_OVERLAP_PX);
    }
    // Each tile stays within a readable aspect ratio.
    for (const t of tiles) {
      expect(t.height).toBeLessThanOrEqual(width * TILE_ASPECT_THRESHOLD);
    }
  });

  it("does not tile just past the threshold boundary", () => {
    const width = 100;
    expect(planTiles(width, width * TILE_ASPECT_THRESHOLD)).toEqual([]);
  });
});

describe("tileImageIfTall", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "amp-tiling-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null for a normal-aspect image", async () => {
    const file = path.join(dir, "normal.png");
    await sharp({
      create: { width: 200, height: 300, channels: 3, background: "#fff" },
    })
      .png()
      .toFile(file);
    expect(await tileImageIfTall(file)).toBeNull();
  });

  it("writes overlapping tiles next to a tall image and returns their paths", async () => {
    const file = path.join(dir, "tall.png");
    await sharp({
      create: { width: 200, height: 2000, channels: 3, background: "#fff" },
    })
      .png()
      .toFile(file);

    const tilePaths = await tileImageIfTall(file);
    expect(tilePaths).not.toBeNull();
    expect(tilePaths!.length).toBeGreaterThan(1);

    let coveredBottom = 0;
    for (const tp of tilePaths!) {
      expect(path.dirname(tp)).toBe(dir);
      const meta = await sharp(tp).metadata();
      expect(meta.width).toBe(200);
      expect(meta.height).toBeGreaterThan(0);
      coveredBottom += meta.height!;
    }
    // Sum of tile heights exceeds source height because of overlaps.
    expect(coveredBottom).toBeGreaterThanOrEqual(2000);
  });
});
