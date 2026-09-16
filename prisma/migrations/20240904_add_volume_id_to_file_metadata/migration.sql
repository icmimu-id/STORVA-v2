-- Migration: add volume_id column to file_metadata
ALTER TABLE "file_metadata" ADD COLUMN "volume_id" INTEGER;
