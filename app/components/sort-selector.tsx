// [LAW:single-enforcer] All sort-mode knowledge (labels, serialization, selectable list)
// comes from sort-mode.ts. This component knows only layout and active-state styling.
// [LAW:dataflow-not-control-flow] click → Link → URL → loader → re-render.
// No client sort state; the URL is the only source of truth.

import { Link } from 'react-router'
import type { SortMode } from '~/lib/sort-mode'
import { selectableSortModes, selectableTopWindows, serializeSortMode, sortModeLabel } from '~/lib/sort-mode'

const WINDOW_LABELS: Record<'day' | 'week' | 'all', string> = {
  day: 'Day',
  week: 'Week',
  all: 'All',
}

function pillClass(active: boolean) {
  return active
    ? 'rounded px-3 py-1 font-mono text-xs uppercase tracking-wider bg-emerald-400/20 text-emerald-300'
    : 'rounded px-3 py-1 font-mono text-xs uppercase tracking-wider text-white/50 hover:text-white/80 hover:bg-white/5 transition'
}

export function SortSelector({ current }: { current: SortMode }) {
  return (
    <div className="flex flex-wrap items-center gap-y-2 gap-x-1">
      <div className="flex flex-wrap gap-1">
        {selectableSortModes.map((mode) => {
          const active = current.mode === mode.mode
          // When already in top, preserve current window instead of jumping to 'all'.
          const target: SortMode = active && current.mode === 'top' ? current : mode
          return (
            <Link
              key={mode.mode}
              to={`/?sort=${serializeSortMode(target)}`}
              className={pillClass(active)}
            >
              {/* [LAW:single-enforcer] sortModeLabel({mode:'top',window:'all'}) === 'Top' */}
              {sortModeLabel(mode)}
            </Link>
          )
        })}
      </div>
      {current.mode === 'top' && (
        <div className="flex gap-1 border-l border-white/10 pl-2 ml-1">
          {selectableTopWindows.map((w) => {
            const mode: SortMode = { mode: 'top', window: w }
            return (
              <Link
                key={w}
                to={`/?sort=${serializeSortMode(mode)}`}
                className={pillClass(current.window === w)}
              >
                {WINDOW_LABELS[w]}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
