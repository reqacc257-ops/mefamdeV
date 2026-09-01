-- Enforce uniqueness on portal_username for simplified applicant login flow.
-- This migration adds a unique constraint so that usernames can be the sole
-- identifier for applicant login (no reference number required).
--
-- Note: PostgreSQL allows multiple NULLs in UNIQUE columns, so this is safe
-- for existing applications with portal_username = NULL.

ALTER TABLE applications
ADD CONSTRAINT unique_portal_username UNIQUE (portal_username)
WHERE portal_username IS NOT NULL;
