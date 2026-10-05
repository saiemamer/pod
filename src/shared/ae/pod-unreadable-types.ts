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

/** One domain's secrets that Pod's key cannot open; entered again in that domain's Domain settings. */
export type PodUnreadableDomainSecrets = {
  domainId: string
  domainName: string
  secretNames: string[]
}

/** Everything the first start found that Pod cannot read, for the one-time notice. */
export type PodStartNoticeContent = {
  credentials: PodCredentialService[]
  domainSecrets: PodUnreadableDomainSecrets[]
  settings: PodUnreadableSetting[]
}
