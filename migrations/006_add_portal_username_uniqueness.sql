-- Enforce uniqueness on portal_username for simplified applicant login flow.
-- This migration adds a unique constraint so that usernames can be the sole
-- identifier for applicant login (no reference number required).
--
-- PostgreSQL partial unique indexes allow multiple NULL portal usernames.
-- Older records may contain duplicate usernames. Preserve each account by
-- assigning later duplicates an ID-based suffix before enforcing uniqueness.
WITH ranked_usernames AS (
	SELECT
		id,
		portal_username,
		ROW_NUMBER() OVER (
			PARTITION BY LOWER(BTRIM(portal_username))
			ORDER BY submitted_at NULLS LAST, id
		) AS username_rank
	FROM applications
	WHERE portal_username IS NOT NULL AND BTRIM(portal_username) <> ''
)
UPDATE applications AS applications_to_update
SET portal_username = ranked_usernames.portal_username || '-' || ranked_usernames.id::TEXT
FROM ranked_usernames
WHERE applications_to_update.id = ranked_usernames.id
	AND ranked_usernames.username_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS unique_portal_username
ON applications (LOWER(BTRIM(portal_username)))
WHERE portal_username IS NOT NULL AND BTRIM(portal_username) <> '';
