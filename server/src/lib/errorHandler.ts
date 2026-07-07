import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";

/**
 * Terminal Express error-handling middleware. Register it AFTER all routes.
 *
 * - Logs the full error server-side for diagnosis.
 * - Returns a sanitized JSON `{ error }` body — never a stack trace.
 * - Maps common Prisma known-request errors to meaningful status codes.
 * - Honors an explicit upstream 4xx status (e.g. multer file-type errors).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("[error]", err);

  if (res.headersSent) return;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: "A record with these values already exists" });
      return;
    }
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const explicitStatus =
    typeof err?.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  const message =
    explicitStatus < 500 && typeof err?.message === "string"
      ? err.message
      : "Internal server error";

  res.status(explicitStatus).json({ error: message });
};
