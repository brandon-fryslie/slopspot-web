import type { Route } from "./+types/api.challenge"
import { issueChallenge } from "~/lib/challenge"

export async function loader({ context }: Route.LoaderArgs) {
  let challenge
  try {
    challenge = await issueChallenge(context.cloudflare.env.SLOPSPOT_CHALLENGE_SECRET)
  } catch {
    return Response.json({ error: "challenge issuer misconfigured" }, { status: 500 })
  }
  return Response.json(challenge, { headers: { 'Cache-Control': 'no-store' } })
}
