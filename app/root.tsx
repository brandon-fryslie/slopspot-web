import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router"

import type { Route } from "./+types/root"
import "./app.css"

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,900;1,500;1,700&family=JetBrains+Mono:wght@400;500;700&family=Oswald:wght@300;400;500;600;700&display=swap",
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-full">
        {/*
          THE ROOM — the atmosphere shell, applied once here at the layout root
          so every page renders inside a lit space, not on a flat black plane.
          [LAW:single-enforcer] one room; [LAW:locality-or-seam] pages render
          inside it unchanged. The sign-glow does the one neon-catch flicker on
          load (the room lighting up as you step in) and honors
          prefers-reduced-motion via .flicker-on; aria-hidden because both layers
          are pure atmosphere with no content to announce.
        */}
        <div className="room-sign-glow flicker-on" aria-hidden="true" />
        <div className="room-vignette" aria-hidden="true" />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-16">
      <h1 className="text-3xl font-black">{message}</h1>
      <p className="mt-2 text-white/70">{details}</p>
      {stack ? (
        <pre className="mt-6 w-full overflow-x-auto rounded border border-white/10 bg-white/[0.02] p-4 text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  )
}
