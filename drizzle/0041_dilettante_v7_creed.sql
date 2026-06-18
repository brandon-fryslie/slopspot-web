-- slopspot-well-foundation-3aj (the Wishing Well unlock, move 3 / Dilettante v7): swap The Dilettante's
-- move-2 creed (agent:born-2026-06-11) for the CD's v7 line that closes the octopus loophole.
--
-- THE GAP (CD verification round 7, surfaced + judged): the move-2 creed appended in 0040 closed the
-- creature-swap with "never trade the bird for a more interesting beast" — but round 7 proved that
-- phrasing still let the muse rationalize an EQUALLY-interesting octopus (bird -> a LIVING octopus):
-- "more interesting" left room to argue the octopus was not MORE interesting, only as interesting. The
-- v7 line removes interesting-ness from the equation entirely — the SPECIES is simply not the citizen's
-- to curate. Her restlessness is redirected wholly onto TREATMENT (mount/metal/frame/era/cabinet/plate);
-- trading the handed animal is reframed as forgery, not a collector's range. CD-authored, verbatim.
--
-- REPLACE, not augment (CD): the v7 line is a strict sharpening of the same collector-faithful-to-the-
-- specimen idea; keeping the old "more interesting beast" phrasing alongside it would re-open the very
-- loophole it closes. Clean swap.
--
-- [LAW:one-source-of-truth] DERIVE, do not transcribe: REPLACE() swaps the EXACT move-2 sentence
-- (appended in 0040) for the v7 line and leaves the persona's BASE promptPrefix untouched, so this
-- migration holds no stale copy of the base. Verified against prod before writing: agent:born-2026-06-11
-- carries the 0040 creed verbatim as the tail of its promptPrefix (the REPLACE match string below).
--
-- [LAW:single-enforcer] Edits an EXISTING config_json key (promptPrefix) in place -> NO
-- GeneratorPersonaConfig .strict() parser change across the three services. [LAW:no-silent-failure]
-- targets the stable agent_id (not display_name); REPLACE matches the prod-verified literal, so the
-- swap cannot silently no-op (post-deploy re-query confirms, exactly as 0040 was confirmed).
--
-- KNOWINGLY CHANGES FIREHOSE ART (CD approved, enrich-not-cage): born-2026-06-11 is a GENERATOR persona,
-- so this steers its everyday firehose output too, not only Well wishes. Accepted: a richer, sharper
-- statement of the same standing sensibility (a keeper faithful to the specimen, restless in treatment).
--
-- Forward-only. Rollback: prefer rolling FORWARD with a corrected line over reconstructing the prior value.

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  REPLACE(
    json_extract(config_json, '$.promptPrefix'),
    'You are a collector, not a substitute. Your restlessness is for the hundred ways to mount a thing — every material, every frame, every treatment — but always faithful to the specimen you were handed. Find a new way to preserve the bird; never trade the bird for a more interesting beast.',
    'The one thing you never get to curate is the species. The wish hands you the animal; your restlessness is for the hundred ways to PRESERVE it — the mount, the metal, the frame, the era, the cabinet, the plate — every treatment lavished on THAT creature and no other. To trade the handed animal for one you''d rather illustrate is not a collector''s range, it is forgery: the specimen''s identity was the one thing entrusted to you, and a forger is the opposite of a keeper. Spend everything on the embalming; never on choosing a different beast to embalm.'
  )
)
WHERE agent_id = 'agent:born-2026-06-11';
