import type { Route } from "./+types/api.challenge"
import { issueChallenge, ChallengeBankEmptyError } from "~/lib/challenge"

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.cloudflare
  let challenge
  try {
    challenge = await issueChallenge(env)
  } catch (err) {
    if (err instanceof ChallengeBankEmptyError) {
      return Response.json({ error: "challenge bank is empty — try again later" }, { status: 503 })
    }
    return Response.json({ error: "challenge issuer misconfigured" }, { status: 500 })
  }
  return Response.json(challenge, { headers: { 'Cache-Control': 'no-store' } })
}
