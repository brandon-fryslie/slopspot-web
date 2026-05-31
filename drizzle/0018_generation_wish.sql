-- The human WISH on a Well-born generation: provenance, never a generation
-- input. Nullable; existing rows and every non-Well generation (firehose, fork,
-- direct API) have NULL. The provider only ever sees the machine-composed
-- prompt column — the wish is stored for provenance and read (later) only by
-- the composer seam.
ALTER TABLE generations ADD COLUMN wish TEXT;
