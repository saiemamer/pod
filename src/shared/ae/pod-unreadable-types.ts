/** Services whose saved credential stayed in Orca's `~/.orca`, sealed with a key Pod no longer uses. */
export type PodCredentialService = 'linear' | 'jira' | 'bitbucket' | 'openai-speech' | 'minimax'

export const POD_CREDENTIAL_SERVICE_LABELS: Record<PodCredentialService, string> = {
  linear: 'Linear',
  jira: 'Jira',
  bitbucket: 'Bitbucket',
  'openai-speech': 'OpenAI speech',
  minimax: 'MiniMax'
}
