import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TuiAgent } from '../../shared/tui-agent'
import type { AeDomainConfig, AeInitiative } from '../../shared/ae/domain-types'
import type { AeDomainService } from './domain-service'

const DEFAULT_AGENT: TuiAgent = 'claude'

function operationId(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}`
}

/** The domain's repos that were ticked when the initiative started. */
function initiativeRepos(
  service: AeDomainService,
  domain: AeDomainConfig,
  initiative: AeInitiative
): { id: string; name: string; path: string; role: string }[] {
  const repos = service.reposInGroup(domain.id)
  return domain.repos
    .filter((entry) => initiative.repoIds.includes(entry.repoId))
    .map((entry) => {
      const repo = repos.find((candidate) => candidate.id === entry.repoId)
      return {
        id: entry.repoId,
        name: repo?.displayName ?? entry.repoId,
        path: repo?.path ?? entry.repoId,
        role: entry.role
      }
    })
}

export function renderInitiativeMarkdown(
  service: AeDomainService,
  domain: AeDomainConfig,
  initiative: AeInitiative
): string {
  return [
    `# ${initiative.title}`,
    '',
    `Domain: ${domain.name} (${domain.id})`,
    initiative.stakeholderTeam ? `For: ${initiative.stakeholderTeam}` : null,
    `Status: ${initiative.status}`,
    `Initiative id: ${initiative.id}`,
    '',
    '## Repos',
    '',
    ...initiativeRepos(service, domain, initiative).map(
      (repo) => `- ${repo.path} (id: ${repo.id}, role: ${repo.role})`
    ),
    '',
    '## Goal',
    '',
    '_Describe the outcome in two or three sentences. What changes for the stakeholder team when this is done?_',
    '',
    '## Plan',
    '',
    '_The main agent fills this in: parts, which repo each part touches, order and dependencies._',
    '',
    '## How this runs',
    '',
    'The main agent works in this folder following `orca skills get ae-initiative`. It creates an orchestration run,',
    'one task per part, and dispatches workers into worktrees of the right repo:',
    '',
    '```sh',
    `orca domain show --domain ${domain.id} --json          # repos, roles, env names`,
    'orca orchestration run-create --objective "<goal>"',
    'orca domain initiative-update --initiative "$POD_INITIATIVE_ID" --run <run> --status running',
    'orca orchestration task-create --run <run> --task-title "<part>" --spec "..." [--deps <task>]',
    'orca worktree create --repo id:<repo> --parent-worktree "$POD_WORKSPACE_KEY" --name <slug>-<part> --json',
    'orca orchestration worker-start --task <task> --worktree id:<worktree_id> --agent claude',
    'orca orchestration check --wait --types worker_done,escalation',
    '```',
    '',
    'Workers in the dbt repo follow `orca skills get ae-dbt`; workers in the Omni repo follow `orca skills get ae-omni`.',
    '',
    '## Notes',
    ''
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function initiativePrompt(
  service: AeDomainService,
  domain: AeDomainConfig,
  initiative: AeInitiative
): string {
  const audience = initiative.stakeholderTeam ? ` for the ${initiative.stakeholderTeam} team` : ''
  const repos = initiativeRepos(service, domain, initiative)
    .map((repo) => `${repo.name} (${repo.role})`)
    .join(', ')
  return [
    `You are the main agent of the ${domain.name} domain, starting the initiative "${initiative.title}"${audience}.`,
    'Read INITIATIVE.md in this folder, then run `orca skills get ae-initiative` and follow that guide.',
    `This initiative works in ${repos || 'no repos'} only; \`orca domain show --domain ${domain.id} --json\` gives their ids and env names.`,
    'Then ask me for the goal if INITIATIVE.md does not have one yet, write the plan into INITIATIVE.md as parts with the repo each touches, and stop for my review before dispatching any worker.'
  ].join(' ')
}

function domainAgentPrompt(domain: AeDomainConfig): string {
  return [
    `You are the standing main agent of the ${domain.name} domain.`,
    `Run \`orca skills get ae-initiative\` and follow it, then \`orca domain show --domain ${domain.id} --json\` to see the repos, their roles and the initiatives so far.`,
    'When I describe a piece of work, turn it into an initiative folder under initiatives/ with an INITIATIVE.md, plan it as parts per repo, and wait for my review before dispatching workers.',
    'Tell me what you found and ask what we are working on.'
  ].join(' ')
}

/**
 * Pod: create the initiative folder, its INITIATIVE.md, a folder workspace under the domain, and
 * the main agent's session. A start that fails undoes what it made, so pressing Start again
 * gives one initiative, not a second record.
 */
export async function launchAeInitiative(
  service: AeDomainService,
  input: {
    domainId: string
    title: string
    stakeholderTeam?: string
    agent?: TuiAgent
    repoIds?: string[]
  }
): Promise<AeInitiative> {
  const domain = service.getDomain(input.domainId)
  if (!domain) {
    throw new Error(
      `Pod could not find the domain for this group. Open Domain settings, save it, and start the initiative again.`
    )
  }
  const agent = input.agent ?? (domain.defaultAgent as TuiAgent | undefined) ?? DEFAULT_AGENT
  const folderPath = service.initiativeFolderPath(domain.id, input.title)
  const firstCreatedDir = makeInitiativeFolder(folderPath)
  const markdownPath = join(folderPath, 'INITIATIVE.md')
  const runtime = service.runtimeService
  let initiative: AeInitiative | null = null
  let wroteMarkdown = false
  let workspaceId: string | null = null
  let step = 'write INITIATIVE.md'
  try {
    initiative = service.saveInitiative({
      domainId: domain.id,
      title: input.title,
      stakeholderTeam: input.stakeholderTeam,
      repoIds: input.repoIds,
      folderPath
    })
    if (!existsSync(markdownPath)) {
      writeFileSync(markdownPath, renderInitiativeMarkdown(service, domain, initiative), 'utf8')
      wroteMarkdown = true
    }
    step = 'open a workspace on the folder'
    const workspace = await runtime.createFolderWorkspace({
      projectGroupId: domain.id,
      name: initiative.title,
      folderPath,
      createdWithAgent: agent,
      creatorProvenance: { kind: 'host' }
    })
    workspaceId = workspace.id
    initiative = service.saveInitiative({
      id: initiative.id,
      domainId: domain.id,
      title: initiative.title,
      coordinatorWorkspaceKey: `folder:${workspace.id}`
    })
    step = 'open the main agent'
    await runtime.createAgentSession({
      clientOperationId: operationId(),
      worktree: `id:folder:${workspace.id}`,
      agent,
      prompt: initiativePrompt(service, domain, initiative),
      promptDelivery: 'draft'
    })
    return initiative
  } catch (error) {
    if (workspaceId) {
      await runtime.deleteFolderWorkspace(workspaceId).catch(() => undefined)
    }
    if (initiative) {
      service.removeInitiative(initiative.id)
    }
    if (wroteMarkdown) {
      rmSync(markdownPath, { force: true })
    }
    removeEmptyDirs(folderPath, firstCreatedDir)
    throw new Error(
      `Pod could not ${step} for "${input.title}" and undid the start (${errorText(error)}). Press Start initiative to try again; if it fails the same way, restart Pod.`
    )
  }
}

/** Returns the first folder it had to create, so a failed start can remove exactly those. */
function makeInitiativeFolder(folderPath: string): string | undefined {
  try {
    return mkdirSync(folderPath, { recursive: true })
  } catch (error) {
    throw new Error(
      `Pod could not make the initiative folder ${folderPath} (${fsErrorText(error)}). Check that you can write to ${dirname(folderPath)}, then press Start initiative again.`
    )
  }
}

function removeEmptyDirs(folderPath: string, firstCreatedDir: string | undefined): void {
  if (!firstCreatedDir) {
    return
  }
  // Why rmdir, never a recursive delete: only folders this start made, and only while empty.
  for (let dir = folderPath; dir.startsWith(firstCreatedDir); dir = dirname(dir)) {
    try {
      rmdirSync(dir)
    } catch {
      return
    }
    if (dir === firstCreatedDir) {
      return
    }
  }
}

function fsErrorText(error: unknown): string {
  switch (error instanceof Error && 'code' in error ? error.code : undefined) {
    case 'EACCES':
    case 'EPERM':
      return 'no permission to write there'
    case 'EROFS':
      return 'that disk is read-only'
    case 'ENOSPC':
      return 'the disk is full'
    case 'EEXIST':
    case 'ENOTDIR':
      return 'a file with that name is in the way'
    default:
      return errorText(error)
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Pod: open (or reopen) the domain's standing main agent in a folder workspace at the domain folder. */
export async function launchAeDomainAgent(
  service: AeDomainService,
  input: { domainId: string; agent?: TuiAgent }
): Promise<{ workspaceKey: string; reused: boolean }> {
  const domain = service.getDomain(input.domainId)
  if (!domain) {
    throw new Error(`Domain "${input.domainId}" not found`)
  }
  const runtime = service.runtimeService
  const agent = input.agent ?? (domain.defaultAgent as TuiAgent | undefined) ?? DEFAULT_AGENT
  const existingId = domain.mainAgentWorkspaceKey?.replace(/^folder:/, '')
  const existing = existingId
    ? runtime.listFolderWorkspaces().find((workspace) => workspace.id === existingId)
    : undefined
  if (existing) {
    return { workspaceKey: `folder:${existing.id}`, reused: true }
  }
  // Why the explicit folder: a group made with "New group from project" has none to fall back on.
  const folderPath = service.domainFolder(domain.id)
  mkdirSync(folderPath, { recursive: true })
  const workspace = await runtime.createFolderWorkspace({
    projectGroupId: domain.id,
    name: `${domain.name} main agent`,
    folderPath,
    createdWithAgent: agent,
    creatorProvenance: { kind: 'host' }
  })
  service.saveDomain({ id: domain.id, mainAgentWorkspaceKey: `folder:${workspace.id}` })
  await runtime.createAgentSession({
    clientOperationId: operationId(),
    worktree: `id:folder:${workspace.id}`,
    agent,
    prompt: domainAgentPrompt(domain),
    promptDelivery: 'draft'
  })
  return { workspaceKey: `folder:${workspace.id}`, reused: false }
}
