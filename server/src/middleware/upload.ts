import multer from "multer";
import path from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";

const uploadDir = path.join(process.cwd(), "uploads");
mkdirSync(uploadDir, { recursive: true });

/**
 * Derive a stored filename from a random token plus the validated extension
 * only — never embed the client-supplied basename, which could contain path
 * separators and escape uploadDir.
 */
function safeFilename(originalname: string): string {
  return `${Date.now()}-${randomUUID()}${path.extname(originalname).toLowerCase()}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(null, safeFilename(file.originalname));
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Use PDF, PNG, JPG, WEBP, or HEIC.`));
    }
  },
});

export const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
  }),
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG/PNG/WebP images allowed"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadPdfOnly = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files allowed"));
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});
