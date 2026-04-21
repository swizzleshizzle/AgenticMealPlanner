-- Migration 002: PDF asset pipeline
-- Adds pdf_path, image_path, image_source to meals for storing
-- uploaded source PDFs and extracted thumbnails.

ALTER TABLE "meals"
  ADD COLUMN "pdf_path" TEXT,
  ADD COLUMN "image_path" TEXT,
  ADD COLUMN "image_source" TEXT;
