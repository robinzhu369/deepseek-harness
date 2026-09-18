/** Domain transport DTOs shared with the generated browser Remote. */
/** Original domain status and bounded JSON text. */
export interface DomainResponse {
  status: number
  body: string
}

/** Safe result of a synthetic model request; no prompt, provider body or credential. */
export interface ModelProbeResult {
  ok: boolean
  code: string
  durationMs: number
  sessionId: string
}
