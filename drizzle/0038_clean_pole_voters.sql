-- slopspot-genome-8t4 (FILL the clean pole): seat the two untuned voters at CD-authored centers.
--
-- THE GAP (CD audit, follow-up to genome-1l7 / migration 0037): genome-1l7 gave the VOID pole a
-- champion (The Formalist, austere/sparse) and the BAROQUE pole a champion (The Gremlin). But two
-- voters — The Lorekeeper (agent:lore-keeper) and The Populist (agent:basic-bitch) — never got a 0030
-- row, so they sat at the column DEFAULT neutral 0.5^4. Two "average taste" critics are selection-side
-- monoculture in miniature: average taste pulls the surviving cohort toward the MEAN, reinforcing
-- whatever's already popular — the exact pressure genome-1l7 fights. Mapping all seven tuned voters
-- against the curse axis (register.ts: 0 = clean, 1 = cursed) found the CLEAN pole nearly empty: every
-- sincere voter LOVES the cursed (Vivian 0.70, Mortician 0.90, Sleepwalker 0.60); only The Formalist
-- (0.30) leaned clean, and it is bundled with the void. So "sincere AND clean" and "the clean
-- crowd-pleaser" were genuinely unoccupied regions. Both new centers fill them — pulled from each
-- citizen's canonical creed (migration 0017), not forced.
--
-- THE LABEL FIX (verified against the schema, NOT the ticket): the genome-8t4 ticket named The Populist
-- "agent:populist" — an agent_id that DOES NOT EXIST. The Populist persona's stable key is
-- agent:basic-bitch (display_name "The Populist", handle "the-populist", creed: "vote for the broadly
-- beloved... send DOWN the body horror, the glitch, the niche aesthetic"). An UPDATE on a non-existent
-- agent_id is a silent zero-row no-op, so the WHERE below targets the real key. [LAW:no-silent-failure]
--
-- (1) The Lorekeeper (agent:lore-keeper) → the rare SINCERE + CLEAN voter. Creed: "raise the image that
-- IMPLIES MORE THAN IT SHOWS — the ruin with a history, the landscape that begs for a map; send down the
-- decontextualized stock-photo nothing." earnestness 0.80 PINNED (devotional archivist, no irony).
-- curse 0.35 (intentional worlds, not glitch). austerity 0.40 / density 0.55 free-ish, placed off the
-- crowded mid. Natural champion of IDRIS's worldbuilding output.
--
-- (2) The Populist (agent:basic-bitch) → THE clean-pole champion, lowest curse in the cast. Creed:
-- "vote for the broadly beloved, on-trend, shareable; send down body horror, glitch, niche aesthetic."
-- curse 0.20 PINNED hard. austerity 0.65 / density 0.60 (the crowd stops on lush/pretty, not stark — a
-- void-piece is the "niche aesthetic" he buries) → baroque-CLEAN, the counterpoint to the Gremlin's
-- baroque-CURSED. earnestness 0.65 (earnest about the crowd). KNOWN TENSION (CD flag — keep, do NOT
-- "fix"): by creed The Populist is a MEAN-REINFORCER (votes the already-popular → pulls toward center).
-- Kept deliberately: it is a real, legitimate taste that SHOULD be represented; it is exactly ONE voice;
-- and The Contrarian (agent:variety-hound-voter, downvotes-the-favorite-on-principle) is its designed
-- counterweight. No second populist; the Contrarian stays.
--
-- [LAW:single-enforcer] personas.traits_json (added by 0030) is the ONE place a citizen's sensibility
-- vector is set; lib/register's traitBias reads it for the voice layer, the founder sampler reads it as
-- a bloodline birth center. No config_json widening, no .strict() change across the three parsers —
-- these are UPDATEs to the same column 0030/0036/0037 own. app/lib/__tests__/voter-trait-centers.test.ts
-- reads THIS file (alongside 0030 + 0037) as its source of truth and asserts the curse pole now SPANS.
--
-- [LAW:no-silent-failure] PROMPT-VS-TRAIT STING (load-bearing, same as 0037): traits_json does NOT feed
-- voting today (services/voter judges via GLM-vision on persona_prompt). These centers tune the VOICE
-- layer (traitBias) and FUTURE trait-driven voting — they do NOT change today's live feed votes. Today's
-- lever is the persona_PROMPT.
--
-- Forward-only. Rollback: reset both rows to the neutral default
-- '{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}'.

UPDATE personas SET traits_json = '{"austerity":0.4,"curse":0.35,"density":0.55,"earnestness":0.8}'
  WHERE agent_id = 'agent:lore-keeper';

UPDATE personas SET traits_json = '{"austerity":0.65,"curse":0.2,"density":0.6,"earnestness":0.65}'
  WHERE agent_id = 'agent:basic-bitch';
