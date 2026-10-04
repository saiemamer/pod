/**
 * Pod: an Omni failure crosses IPC and RPC as one message string, the plain summary and
 * then the CLI's own text after this marker, so every surface can split them again.
 */
export const OMNI_DETAILS_MARKER = '\n\nDetails from omni:\n'

export function withOmniDetails(summary: string, details: string): string {
  const trimmed = details.trim()
  return trimmed ? `${summary}${OMNI_DETAILS_MARKER}${trimmed}` : summary
}

export function splitOmniDetails(raw: string): { summary: string; details: string | null } {
  // Why: Electron's IPC rejection reads `<error name>: <message>`, after its own prefix.
  const text = raw.replace(/^OmniCliError: /, '')
  const at = text.indexOf(OMNI_DETAILS_MARKER)
  if (at === -1) {
    return { summary: text, details: null }
  }
  return {
    summary: text.slice(0, at),
    details: text.slice(at + OMNI_DETAILS_MARKER.length) || null
  }
}
