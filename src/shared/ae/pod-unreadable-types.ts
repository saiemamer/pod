/** Services whose saved credential stayed in Orca's `~/.orca`, sealed with a key Pod no longer uses. */
export type PodCredentialService = 'linear' | 'jira' | 'bitbucket' | 'openai-speech' | 'minimax'

export const POD_CREDENTIAL_SERVICE_LABELS: Record<PodCredentialService, string> = {
  linear: 'Linear',
  jira: 'Jira',
  bitbucket: 'Bitbucket',
  'openai-speech': 'OpenAI speech',
  minimax: 'MiniMax'
}

/** Saved settings sealed with a key Pod cannot open; each is entered again where it was set. */
export type PodUnreadableSetting =
  | 'opencodeGoApiKey'
  | 'opencodeSessionCookie'
  | 'httpProxyUrl'
  | 'browserKagiSessionLink'

export const POD_UNREADABLE_SETTING_LABELS: Record<PodUnreadableSetting, string> = {
  opencodeGoApiKey: 'OpenCode Go API key',
  opencodeSessionCookie: 'OpenCode Go session cookie',
  httpProxyUrl: 'proxy URL',
  browserKagiSessionLink: 'Kagi session link'
}
