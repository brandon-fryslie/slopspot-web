// [LAW:single-enforcer] The only writer to R2. Every caller that produces a
// remote image URL — provider responses today, user uploads tomorrow — funnels
// through ingestImage. R2 stays a private binding; the URL we return is the
// canonical reference the rest of the app stores in place of the upstream
// (fal/replicate) URL.
//
// [LAW:one-source-of-truth] The object key IS the sha256 of the bytes. There is
// no separate "id" or "filename" the app has to remember; given the bytes, the
// key is computable. Two ingestions of byte-identical content collapse to one
// stored object.

const MAX_BYTES = 20 * 1024 * 1024

export type IngestedImage = {
  readonly url: string
  readonly key: string
  readonly size: number
  readonly contentType: string
}

export async function ingestImage(remoteUrl: string, env: Env): Promise<IngestedImage> {
  const upstream = await fetch(remoteUrl)
  if (!upstream.ok) {
    throw new Error(
      `ingestImage: upstream ${upstream.status} ${upstream.statusText} for ${remoteUrl}`,
    )
  }
  const contentType = upstream.headers.get("content-type") ?? ""
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `ingestImage: non-image content-type "${contentType}" for ${remoteUrl}`,
    )
  }
  const buffer = await upstream.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error(`ingestImage: empty body for ${remoteUrl}`)
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `ingestImage: body ${buffer.byteLength} exceeds ${MAX_BYTES} cap for ${remoteUrl}`,
    )
  }

  const key = await sha256Hex(buffer)

  // [LAW:dataflow-not-control-flow] No "does it exist?" head-check before put.
  // The key is the content address, so a repeat put is byte-identical and the
  // result is the same object — same code path every invocation; dedup falls
  // out of the data, not from a guard.
  await env.MEDIA.put(key, buffer, { httpMetadata: { contentType } })

  return {
    url: `/media/${key}`,
    key,
    size: buffer.byteLength,
    contentType,
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  let out = ""
  const view = new Uint8Array(digest)
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0")
  }
  return out
}
