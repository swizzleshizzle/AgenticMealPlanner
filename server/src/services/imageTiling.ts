/**
 * imageTiling.ts — split very tall images into overlapping slices before OCR.
 *
 * Online-order screenshots (e.g. a full Walmart purchase-history page) arrive
 * as extreme-aspect images like 1149×9678. The model API downscales images to
 * a bounded long edge, which makes the text in an 8:1+ image illegible and the
 * parse silently returns zero items. Slicing into ~2.5:1 tiles keeps every
 * line item readable. Tiles overlap so no row is lost at a seam; the parse
 * prompt instructs the model to dedupe rows repeated in the overlap.
 */

import path from "path";
import sharp from "sharp";

/** Tile when height exceeds this multiple of width. */
export const TILE_ASPECT_THRESHOLD = 3;

/** Each tile is this multiple of the image width tall (below the threshold). */
const TILE_HEIGHT_RATIO = 2.5;

/** Vertical overlap between consecutive tiles, in pixels. */
export const TILE_OVERLAP_PX = 100;

export interface TilePlan {
  top: number;
  height: number;
}

/** Returns [] when the image does not need tiling. */
export function planTiles(width: number, height: number): TilePlan[] {
  if (width <= 0 || height <= 0) return [];
  if (height <= width * TILE_ASPECT_THRESHOLD) return [];

  const tileHeight = Math.round(width * TILE_HEIGHT_RATIO);
  const step = tileHeight - TILE_OVERLAP_PX;
  const tiles: TilePlan[] = [];
  let top = 0;
  for (;;) {
    tiles.push({ top, height: Math.min(tileHeight, height - top) });
    if (top + tileHeight >= height) break;
    top += step;
  }
  return tiles;
}

/**
 * If the image at imagePath is tall enough to need tiling, writes the tiles
 * next to it (as PNGs) and returns their paths in top-to-bottom order.
 * Returns null when no tiling is needed.
 */
export async function tileImageIfTall(imagePath: string): Promise<string[] | null> {
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) return null;

  const plan = planTiles(meta.width, meta.height);
  if (plan.length === 0) return null;

  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  const tilePaths: string[] = [];
  for (let i = 0; i < plan.length; i++) {
    const tilePath = path.join(dir, `${base}.tile${i}.png`);
    await sharp(imagePath)
      .extract({ left: 0, top: plan[i].top, width: meta.width, height: plan[i].height })
      .png()
      .toFile(tilePath);
    tilePaths.push(tilePath);
  }
  return tilePaths;
}
