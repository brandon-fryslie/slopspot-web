import { data, Form, useLoaderData } from 'react-router'
import { listPersonas, updatePersonaConfig } from '~/agents/persona'
import { voterStats } from '~/db/votes'
import { AgentId } from '~/lib/domain'
import { requireAdmin } from '~/lib/admin-auth'
import { parseSchedulerConfig } from '~/lib/scheduler'
import type { Route } from './+types/admin.personas'

export function meta() {
  return [{ title: 'SlopSpot Admin — Personas' }]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const key = await requireAdmin(request, env)

  const personas = await listPersonas(env, 'voter')
  const stats = await voterStats(
    env,
    personas.map((p) => p.agentId),
  )
  const statsByVoterId = Object.fromEntries(stats.map((s) => [s.voterId, s]))

  const rows = personas.map((p) => {
    const schedulerConfig = parseSchedulerConfig(p.config)
    const s = statsByVoterId[p.agentId]
    return {
      agentId: p.agentId,
      displayName: p.displayName,
      config: p.config,
      schedulerConfig,
      voteCount: s?.voteCount ?? 0,
      upvotes: s?.upvotes ?? 0,
      downvotes: s?.downvotes ?? 0,
    }
  })

  return data({ rows, key })
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAdmin(request, env)

  const form = await request.formData()
  const agentId = form.get('agentId')
  const configJson = form.get('config')

  if (typeof agentId !== 'string' || typeof configJson !== 'string') {
    throw data('Bad request', { status: 400 })
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(configJson) as Record<string, unknown>
  } catch {
    throw data('Invalid JSON in config', { status: 400 })
  }

  // Validate scheduler config before persisting; propagate as 400 so the admin
  // sees the validation message rather than a generic 500.
  try {
    parseSchedulerConfig(config)
  } catch (err) {
    throw data(err instanceof Error ? err.message : 'Invalid scheduler config', { status: 400 })
  }

  await updatePersonaConfig(env, AgentId(agentId), config)

  return data({ ok: true })
}

type Row = Awaited<ReturnType<typeof loader>>['data']['rows'][number]

function PersonaRow({ row, actionUrl }: { row: Row; actionUrl: string }) {
  const cfg = row.config
  const cfgStr = JSON.stringify(cfg, null, 2)

  return (
    <tr className="border-b border-gray-700 align-top">
      <td className="py-3 pr-4 font-mono text-xs text-gray-300 whitespace-nowrap">
        {row.agentId}
      </td>
      <td className="py-3 pr-4 text-sm text-white">{row.displayName}</td>
      <td className="py-3 pr-4 text-sm text-gray-300 text-center">{row.voteCount}</td>
      <td className="py-3 pr-4 text-sm text-green-400 text-center">{row.upvotes}</td>
      <td className="py-3 pr-4 text-sm text-red-400 text-center">{row.downvotes}</td>
      <td className="py-3 pr-4 text-sm text-blue-300 text-center">
        {row.schedulerConfig.expectedDailyFires}/day
        {row.schedulerConfig.activeHoursUtc && (
          <span className="ml-1 text-gray-400 text-xs">
            ({row.schedulerConfig.activeHoursUtc.startHour}–
            {row.schedulerConfig.activeHoursUtc.endHour}h UTC)
          </span>
        )}
      </td>
      <td className="py-3">
        <Form method="post" action={actionUrl}>
          <input type="hidden" name="agentId" value={row.agentId} />
          <textarea
            name="config"
            defaultValue={cfgStr}
            className="w-64 h-40 font-mono text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded p-2 resize-y"
          />
          <div className="mt-1">
            <button
              type="submit"
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
            >
              Save
            </button>
          </div>
        </Form>
      </td>
    </tr>
  )
}

export default function AdminPersonas() {
  const { rows, key } = useLoaderData<typeof loader>()
  const actionUrl = `/admin/personas?key=${encodeURIComponent(key)}`

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-2xl font-bold mb-2">Voter Personas</h1>
      <p className="text-gray-400 text-sm mb-6">
        Config edits take effect on the next 15m Nomad voter tick — no restart
        required.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-600 text-gray-400 text-xs uppercase tracking-wide">
              <th className="pb-2 pr-4">Agent ID</th>
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4 text-center">Votes</th>
              <th className="pb-2 pr-4 text-center">Up</th>
              <th className="pb-2 pr-4 text-center">Down</th>
              <th className="pb-2 pr-4 text-center">Cadence</th>
              <th className="pb-2">Config JSON</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PersonaRow key={row.agentId} row={row} actionUrl={actionUrl} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
