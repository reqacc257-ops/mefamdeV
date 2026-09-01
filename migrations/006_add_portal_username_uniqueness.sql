-- Enforce uniqueness on portal_username for simplified applicant login flow.
-- This migration adds a unique constraint so that usernames can be the sole
-- identifier for applicant login (no reference number required).
--
-- PostgreSQL partial unique indexes allow multiple NULL portal usernames.
CREATE UNIQUE INDEX unique_portal_username
ON applications (portal_username)
WHERE portal_username IS NOT NULL;
