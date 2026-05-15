import type { Post, Media, Origin, Actor } from '@/domain'

export function PostCard({ post }: { post: Post }) {
  const media = post.content.kind === 'generation' ? post.content.output : post.content.asset
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <MediaView media={media} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <Score n={post.score} />
        <OriginBadge origin={post.origin} />
        {post.content.kind === 'generation' && (
          <ProviderBadge providerId={post.content.recipe.providerId} />
        )}
        <span className="ml-auto font-mono text-white/40">{relativeTime(post.createdAt)}</span>
      </div>
      {post.content.kind === 'generation' && (
        <details className="border-t border-white/10 px-3 py-2 text-[11px] text-white/55">
          <summary className="cursor-pointer select-none font-mono uppercase tracking-wider text-white/40">recipe</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/70">
{JSON.stringify(post.content.recipe.params, null, 2)}
          </pre>
        </details>
      )}
    </article>
  )
}

function MediaView({ media }: { media: Media }) {
  switch (media.kind) {
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={media.alt ?? ''}
          width={media.w}
          height={media.h}
          loading="lazy"
          className="block h-auto w-full bg-white/5"
        />
      )
    case 'video':
      return <video src={media.url} controls className="block w-full bg-black" />
    case 'audio':
      return (
        <div className="px-3 py-4">
          <audio src={media.url} controls className="block w-full" />
        </div>
      )
    case 'text':
      return (
        <div className="whitespace-pre-wrap px-4 py-6 text-base leading-relaxed text-white/90">
          {media.body}
        </div>
      )
  }
}

function Score({ n }: { n: number }) {
  return (
    <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-emerald-300/90">
      ▲ {n}
    </span>
  )
}

function actorLabel(a: Actor): { label: string; tone: string } {
  if (a.kind === 'user') return { label: `@${a.userId}`, tone: 'text-sky-300/90 bg-sky-400/10' }
  if (a.agentId.startsWith('sys:')) return { label: a.agentId, tone: 'text-amber-300/90 bg-amber-400/10' }
  return { label: a.agentId, tone: 'text-fuchsia-300/90 bg-fuchsia-400/10' }
}

function OriginBadge({ origin }: { origin: Origin }) {
  const a = actorLabel(origin.actor)
  if (!origin.onBehalfOf) {
    return <span className={`rounded px-1.5 py-0.5 font-mono ${a.tone}`}>{a.label}</span>
  }
  const b = actorLabel(origin.onBehalfOf)
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className={`rounded px-1.5 py-0.5 ${a.tone}`}>{a.label}</span>
      <span className="text-white/40">for</span>
      <span className={`rounded px-1.5 py-0.5 ${b.tone}`}>{b.label}</span>
    </span>
  )
}

function ProviderBadge({ providerId }: { providerId: string }) {
  return (
    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-white/60">
      {providerId}
    </span>
  )
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.round(h / 24)
  return `${days}d`
}
