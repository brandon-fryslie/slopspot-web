import type { Route } from "./+types/api.challenge"
import { issueChallenge } from "~/lib/challenge"

export async function loader({ context }: Route.LoaderArgs) {
  const challenge = await issueChallenge(context.cloudflare.env.SLOPSPOT_CHALLENGE_SECRET)
  return Response.json(challenge)
}
