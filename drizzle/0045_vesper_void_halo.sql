-- slopspot-render-fidelity-g5e (the VANISH/BURY 4th render mode): part B of the CD's A+B cold ruling
-- (2026-06-23). The round-11 verdict found a failure pole that v2l's three modes (swap/promote/live)
-- do NOT catch: Vesper Sloan's (agent:the-cursed-one) teeming baroque scene SWALLOWS its own embalmed
-- relic until the wish VANISHES, even when the prompt is already clean. Her CONTAINED scenes kept the
-- relic and passed (vesper-fish-12 plinth, vesper-fish-base glass case); her teeming ones buried it.
--
-- THE LEVER (CD): a global directive clause cannot beat a baroque voice — the existing anti-vanish
-- language already LOST that priority fight (that is why g5e's part A names VANISH as a distinct pole
-- rather than relying on the old clause). The ONLY lever proven to beat a voice is the 0040 pattern:
-- deepen the citizen's OWN creed so the cure reads as HER fierce instinct, not a foreign rule. 0040
-- already gave Vesper "every gilt flourish accretes to exalt the relic at its center ... a pile with
-- nothing at its heart is only furniture." But "enshrine/heap upon a core" is a move her excess can
-- satisfy by piling MORE — which is exactly how it buries. This line sharpens enshrine into its
-- SPATIAL form: the filigree must PART around the relic, opening a clear void-halo, so excess exalts
-- by NEGATIVE SPACE the eye reads first, not by accretion that drowns. Enshrining is not burying.
--
-- [LAW:one-source-of-truth] DERIVE, do not transcribe: reads the row's CURRENT promptPrefix via
-- json_extract and APPENDS, so this migration holds no stale copy of the 0040 line. json_set re-encodes
-- the JSON (escaping the em-dashes for free); only the SQL string literal is hand-escaped (none needed
-- here — the appended prose carries no apostrophes). Separator is a single space because the 0040 line
-- already ends in a period.
--
-- [LAW:single-enforcer] promptPrefix already exists on this config_json row (seeded 0007-0012, tuned
-- 0040) -> additive to an EXISTING key, so NO GeneratorPersonaConfig .strict() parser change is needed.
-- [LAW:no-silent-failure] targets the stable agent_id (NOT display_name) so a rename can never turn this
-- UPDATE into a silent zero-row no-op.
--
-- KNOWINGLY CHANGES FIREHOSE ART (CD approved, exaltation-of-the-center should govern ALL her work):
-- agent:the-cursed-one is a generator, so this prefix steers her everyday firehose output too. The CD
-- ruled this a FEATURE — the void-halo is her standing sensibility made fierce, an enrichment of her
-- taste, not a leash. Forward-only; prefer rolling FORWARD with a corrected line over reconstructing.

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || ' ' ||
  'But enshrining is not burying — the more lavish the pile, the more fiercely the filigree must PART around the relic: open a clear void-halo at its heart so the eye finds the bones FIRST and only then drowns in your splendour. A relic the eye cannot find at a glance has been buried, and burial is the one heresy your abundance can commit.'
)
WHERE agent_id = 'agent:the-cursed-one';
