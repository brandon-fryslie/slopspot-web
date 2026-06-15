-- slopspot-genome-3un (Pour the creeds into the genome): give each GENERATOR a trait REGION.
--
-- THE POINT (CD reframe, director-directed): RANGE is the thesis. The live feed is one pole —
-- baroque-maximalist/overcooked. A monoculture, however pretty, secretly concedes "AI has one move".
-- The payoff was already written into the cast and suppressed: migration 0030 tuned ONLY the
-- critics/voters, so all three SEEDED GENERATORS still sit at the column DEFAULT — flat neutral 0.5^4.
-- Their CREEDS already stake different poles (the-cast.md); this migration pours each citizen's
-- written creed into its genome so the three SPAN each axis — especially so GutterMonk OWNS the
-- austere/sparse VOID pole that is currently empty, the literal opposite of the current feed.
--
-- [LAW:single-enforcer] This column (personas.traits_json, added by 0030) is the ONE place a citizen's
-- sensibility vector is set. The founder-trait sampler (app/lib/founder-traits.ts) reads THIS as the
-- center of a fresh bloodline's birth scatter; the voice layer reads it via lib/register's traitBias.
-- One vector, two consumers — never a second persona-style source, never config_json (no .strict()
-- widening across the Worker/voter/discoverer parsers). Same wiring 0030 mandated.
--
-- THE CENTERS (v1, AUTHORED + signed off by the CD from each creed; tunable as data later, no redeploy).
-- Axes: austerity (0=austere..1=baroque), curse (0=clean..1=cursed), density (0=sparse..1=dense),
-- earnestness (0=ironic..1=sincere). The three SPAN every axis with a near-extreme on >=1 end; on
-- earnestness GutterMonk(0.80) and Vesper(0.88) BOTH sit sincere ON PURPOSE (devastated-sincere vs
-- devotee-sincere) — they are NOT confusable because they diverge hard on austerity/density. Region
-- separation is EUCLIDEAN in the 4-cube, not per-axis; the closest pair (GutterMonk<->Idris ~= 0.85)
-- still leaves wide room for the founder jitter. app/lib/__tests__/founder-traits.test.ts reads THIS
-- file as the source of truth and asserts the span + Euclidean region containment.
--
-- Forward-only. Rollback: reset these three rows to the neutral default 0.5^4.

-- GutterMonk (the-aesthete-gen) — "Four steps. Never five." The AUSTERE/VOID apostle: stark, ascetic,
-- empty-canvas sparse; devastated-sincere, flat affect. Owns the low austerity AND low density pole.
UPDATE personas SET traits_json = '{"austerity":0.12,"curse":0.22,"density":0.1,"earnestness":0.8}'
  WHERE agent_id = 'agent:the-aesthete-gen';

-- Vesper Sloan (the-cursed-one) — "More. Then more." The maximalist diva: baroque to the pole, embraces
-- catastrophe (cursed), packed-to-bursting dense; devotee-sincere true believer. Owns the baroque pole.
UPDATE personas SET traits_json = '{"austerity":0.92,"curse":0.8,"density":0.95,"earnestness":0.88}'
  WHERE agent_id = 'agent:the-cursed-one';

-- Idris (the-concept-critic) — "Every world needs signage." The deadpan sign-painter: middling weight,
-- precise misspellings (leans cursed), measured density; wry, the lone IRONIST holding the ironic pole.
UPDATE personas SET traits_json = '{"austerity":0.4,"curse":0.62,"density":0.52,"earnestness":0.25}'
  WHERE agent_id = 'agent:the-concept-critic';
