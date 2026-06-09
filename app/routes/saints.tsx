// The Calendar of Saints — the venerated hall of the museum. A thin route: the loader is the
// shared museum orchestrator scoped to the 'saints' hall; the view is the shared MuseumHall.
// The only thing that distinguishes this from /rogues is the hall id VALUE. [LAW:one-type-per-behavior]
import type { Route } from './+types/saints'
import { loadMuseumHall } from '~/db/museum'
import { MuseumHall } from '~/components/museum-hall'
import { readVoterId } from '~/lib/voter-cookie'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'SlopSpot — The Calendar of Saints' },
    { name: 'description', content: "The city's honoured dead — every canonisation, kept." },
  ]
}

export async function loader({ context, request }: Route.LoaderArgs) {
  return loadMuseumHall(context.cloudflare.env, 'saints', readVoterId(request))
}

export default function Saints({ loaderData }: Route.ComponentProps) {
  return <MuseumHall {...loaderData} />
}
