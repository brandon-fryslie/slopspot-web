// [LAW:single-enforcer] This layout route is the single auth gate for all
// /admin/* routes. Child loaders and actions call requireAdmin too (since
// RR7 actions run independently of layout loaders), but the auth logic
// is defined once in app/lib/admin-auth.ts.

import { Outlet } from 'react-router'
import { requireAdmin } from '~/lib/admin-auth'
import type { Route } from './+types/admin'

export async function loader({ request, context }: Route.LoaderArgs) {
  const key = requireAdmin(request, context.cloudflare.env)
  return { key }
}

export default function AdminLayout() {
  return <Outlet />
}
