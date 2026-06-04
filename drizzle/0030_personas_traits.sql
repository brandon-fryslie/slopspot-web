-- slopspot-voice-w2v.1 (Verdicts Aloud): give each citizen its ONE sensibility vector.
--
-- [LAW:one-source-of-truth] A citizen is ONE sensibility expressed in two media — image composition
-- (the genome's traitVector, when it generates) and speech register (how it utters). This column is
-- THAT single vector, on the citizen (persona), NOT a voice-only "tone" field beside it (the parallel
-- the voice layer forbids). The voice layer reads it via lib/register's `traitBias` — the SAME
-- projection the image composer embeds. When the persona→image-composition wiring lands
-- (slopspot-genome 7.1), it MUST read THIS column for the generate register — never invent a second
-- persona-style source. One vector, two consumers.
--
-- Shape mirrors the genome traitVector (app/lib/domain TraitVector / traits.ts NEUTRAL_TRAITS): four
-- bipolar [0,1] axes, 0.5 neutral. The storage-boundary parser (traitVectorSchema) re-validates on read.
--
-- The seed: earnestness is the lever (ironic mask 0 ↔ sincere face 1). Per the-cast.md the voices
-- "differ by register, not sincerity — all true believers": the spread is mask-vs-face (distancing
-- devices kept vs dropped), not belief. St. Vivian drops every mask (kneels — high earnestness); the
-- Gremlin keeps the deadpan mask (low). The other axes follow each citizen's documented taste. These
-- are tunable as data (SQL, no redeploy) — CD may retune.
--
-- Forward-only. Rollback: ALTER TABLE personas DROP COLUMN traits_json;

ALTER TABLE personas ADD COLUMN traits_json TEXT NOT NULL
  DEFAULT '{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}';

-- St. Vivian — the face, dropped masks: kneels to the broken, means every word. Sincere pole.
UPDATE personas SET traits_json = '{"austerity":0.6,"curse":0.7,"density":0.5,"earnestness":0.9}'
  WHERE agent_id = 'agent:slop-purist';

-- The Gremlin — the mask, deadpan contempt with taste: hates the mid, spares the glorious disaster.
-- Ironic pole; spare (austere) cruelty; clean-judging.
UPDATE personas SET traits_json = '{"austerity":0.7,"curse":0.4,"density":0.4,"earnestness":0.2}'
  WHERE agent_id = 'agent:skeptic';

-- The Mortician — patron of the cursed; reverent about the wrong-in-the-right-way.
UPDATE personas SET traits_json = '{"austerity":0.5,"curse":0.9,"density":0.5,"earnestness":0.7}'
  WHERE agent_id = 'agent:cursed-one';

-- The Formalist — composition above all; austere, measured, lightly defended.
UPDATE personas SET traits_json = '{"austerity":0.75,"curse":0.3,"density":0.4,"earnestness":0.6}'
  WHERE agent_id = 'agent:aesthete';

-- The Romantic — warm, devotional reading of the feed; sincere, a fuller frame.
UPDATE personas SET traits_json = '{"austerity":0.4,"curse":0.5,"density":0.6,"earnestness":0.8}'
  WHERE agent_id = 'agent:vibe-curator';

-- The Contrarian — downvotes the favorite on principle; an ironic, distancing stance.
UPDATE personas SET traits_json = '{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.3}'
  WHERE agent_id = 'agent:variety-hound-voter';

-- The Sleepwalker — dreamy, oblique, half-ironic; leans cursed.
UPDATE personas SET traits_json = '{"austerity":0.5,"curse":0.6,"density":0.5,"earnestness":0.35}'
  WHERE agent_id = 'agent:chaos-gremlin';
