import { homedir } from 'node:os'
import { join } from 'node:path'

/** Orca's credential folder; the store tests mock `node:fs`, so this module touches no file. */
const ORCA_CREDENTIAL_DIR_NAME = '.orca'

let podCredentialDir: string | null = null

/**
 * Where the Linear, Jira, Bitbucket, OpenAI speech and MiniMax stores keep their files.
 * Packaged Pod seals with "Pod Safe Storage", which Orca cannot read, so it keeps them apart
 * from Orca's `~/.orca`; development builds and E2E launches keep Orca's folder.
 */
export function integrationCredentialDir(): string {
  return podCredentialDir ?? join(homedir(), ORCA_CREDENTIAL_DIR_NAME)
}

export function setPodCredentialDir(dir: string): void {
  podCredentialDir = dir
}

/** Test-only: back to Orca's folder. */
export function _resetIntegrationCredentialDirForTests(): void {
  podCredentialDir = null
}
