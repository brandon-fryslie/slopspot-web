// [LAW:single-enforcer][LAW:one-source-of-truth] The one exhaustiveness-failure
// helper for the whole app. A closed union switched exhaustively binds `never`
// in its default arm; passing that value here makes `tsc -b` reject any
// unhandled variant at compile time, and — should a value leak past the types
// (storage corruption, a cast) — fail loud at runtime instead of silently
// falling through. [LAW:no-silent-failure]
//
// `context` is an optional localizer (e.g. `status for post ${id}`): the call
// site's variation lives in that value, not in a second function or a mode.
// [LAW:dataflow-not-control-flow]
export function assertNever(value: never, context?: string): never {
  const where = context ? ` (${context})` : ''
  throw new Error(`unhandled variant${where}: ${JSON.stringify(value)}`)
}
