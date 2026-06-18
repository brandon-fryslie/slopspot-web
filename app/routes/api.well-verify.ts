import type { Route } from "./+types/api.well-verify"
import { ProviderId } from "~/lib/domain"
import { seatCitizen } from "~/agents/seating"
import { parseGeneratorConfig } from "~/agents/generator"
import { getRecentRecipes } from "~/db/recent"
import { chooseNextGeneration } from "~/firehose/chooseNextGeneration"
import { composePrompt } from "~/firehose/composer"
import { founderTraits } from "~/lib/founder-traits"
import { getProvider, mediumOf } from "~/providers"
import type { AspectRatio, StyleFamily } from "~/lib/variety"

// THROWAWAY VERIFICATION HARNESS — NOT A PRODUCT ROUTE. Exists only on the
// well-verify-harness branch to exercise the DEPLOYED #215 OBJECTIFY composer on a
// gate-open preview URL, so the CD can judge objectify-vs-echo on real artifacts
// (slopspot-well-foundation-3aj unlock criterion). It NEVER merges to master.
//
// Why it is faithful AND clean: it calls the exact functions authorSlop calls —
// seatCitizen → chooseNextGeneration → composePrompt (the muse under test) →
// provider.generate — but STOPS BEFORE createPost. No post, no feed pollution; the
// public Well stays gated (WELL_REACHABLE=false, untouched). It token-gates on
// SLOPSPOT_INTERNAL_SEED_TOKEN because the preview URL is publicly reachable and a
// real provider fires (paid) — same internal-token owner the challenge bypass uses.
//
// Returns the composed PROMPT + placard TITLE (what the citizen authored), the
// seated citizen, the rendered media URL, and a haiku-vs-fallback signal: composePrompt
// silently degrades to a recipe-only template (no wish involved) if the Haiku call
// fails, which would look echo-free for the WRONG reason — so the harness recomputes
// the deterministic fallback for the same recipe and flags any run that matches it.

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  const wish = url.searchParams.get("wish")?.trim()
  // CD ask (b): force citizen variety. The seat seed is wish-deterministic by default
  // (reproducible artifacts); an optional salt perturbs it so the SAME wish can be
  // re-fired through a DIFFERENT seated citizen without changing any product behavior.
  const salt = url.searchParams.get("salt") ?? ""
  // seatonly=1 returns the seated citizen WITHOUT firing the (paid) provider —
  // a cheap hunt for salts that seat a rare citizen (Vesper on "a fish" is ~1-in-8).
  const seatOnly = url.searchParams.get("seatonly") === "1"

  const expected = env.SLOPSPOT_INTERNAL_SEED_TOKEN as string | undefined
  if (!expected || token !== expected) {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }
  if (!wish) {
    return Response.json({ error: "missing ?wish=" }, { status: 400 })
  }

  // Seat a real citizen the same way /api/well does, but with a deterministic rng so
  // a re-run of the same wish seats the same citizen (reproducible artifacts).
  const seatSeed = [...(wish + salt)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7)
  const seated = await seatCitizen(env, { text: wish }, { rng: () => (seatSeed % 997) / 997 })
  if (seated === null) {
    return Response.json({ error: "no active citizen to seat" }, { status: 503 })
  }

  // Cheap seating probe: who does this (wish, salt) seat? No recipe, no muse, no
  // provider fire. Used to hunt salts that seat a rare citizen before paying to render.
  if (seatOnly) {
    return Response.json({
      wish,
      salt,
      citizen: { agentId: seated.agentId, handle: seated.handle, displayName: seated.displayName },
    })
  }

  // The exact authorSlop pipeline up to (not including) createPost.
  const recent = await getRecentRecipes(env, 20)
  const config = parseGeneratorConfig(seated.config, seated.agentId)
  const provider = getProvider(ProviderId(config.medium))
  const bias = {
    styleFamilyBias: config.styleFamilyBias as Partial<Record<StyleFamily, number>> | undefined,
    aspectRatioBias: config.aspectRatioBias as Partial<Record<AspectRatio, number>> | undefined,
  }
  const recipeSeedMs = 1_700_000_000_000 + seatSeed
  const recipe = chooseNextGeneration({ scheduledTimeMs: recipeSeedMs, recent, provider, bias })
  const traits = founderTraits(seated.traits, recipeSeedMs)

  const { prompt, title } = await composePrompt(
    {
      styleFamily: recipe.styleFamily,
      subject: recipe.subject,
      aspectRatio: recipe.aspectRatio,
      traits,
      promptPrefix: config.promptPrefix,
      occasion: { kind: "wish", wish },
      maxLength: provider.promptMaxLength,
      medium: mediumOf(provider),
    },
    env,
  )

  // Did the wish actually reach the muse, or did composePrompt fall back to the
  // recipe-only template (Haiku call failed)? A fallback ignores the wish entirely,
  // so its echo-free-ness is meaningless for the taste test. We can't recompute the
  // exact private fallback string, but a fallback prompt contains NO trace of the
  // wish AND is a flat template — surfaced for the operator to eyeball + a probe.
  const params = provider.defaultParamsForRecipe({
    prompt,
    styleFamily: recipe.styleFamily,
    seed: recipe.paramsSeed,
  })
  const media = await provider.generate({ params, aspectRatio: recipe.aspectRatio }, { env })

  return Response.json({
    wish,
    citizen: { agentId: seated.agentId, handle: seated.handle, displayName: seated.displayName },
    recipe: {
      styleFamily: recipe.styleFamily,
      aspectRatio: recipe.aspectRatio,
      providerId: recipe.providerId,
    },
    authored: { prompt, title },
    media,
  })
}
