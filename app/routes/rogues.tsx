// The Rogues' Gallery — the beautiful-monsters hall of the museum (every Villain, every
// Heretic). A thin route: the loader is the shared museum orchestrator scoped to the 'rogues'
// hall; the view is the shared MuseumHall. Distinguished from /saints only by the hall id
// VALUE. [LAW:one-type-per-behavior]
import type { Route } from './+types/rogues'
import { loadMuseumHall } from '~/db/museum'
import { MuseumHall } from '~/components/museum-hall'
import { readVoterId } from '~/lib/voter-cookie'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "SlopSpot — The Rogues' Gallery" },
    { name: 'description', content: "The city's hall of beautiful monsters." },
  ]
}

export async function loader({ context, request }: Route.LoaderArgs) {
  return loadMuseumHall(context.cloudflare.env, 'rogues', readVoterId(request))
}

export default function Rogues({ loaderData }: Route.ComponentProps) {
  return <MuseumHall {...loaderData} />
}
