import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TuiAgent } from '../../shared/tui-agent'
import type { AeDomainConfig, AeInitiative } from '../../shared/ae/domain-types'
import type { AeDomainService } from './domain-service'

const DEFAULT_AGENT: TuiAgent = 'claude'

function operationId(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}`
}

function repoLines(service: AeDomainService, domain: AeDomainConfig): string[] {
  const repos = service.reposInGroup(domain.id)
  return domain.repos.map((entry) => {
    const repo = repos.find((candidate) => candidate.id === entry.repoId)
    return `- ${repo?.path ?? entry.repoId} (id: ${entry.repoId}, role: ${entry.role})`
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
    ...repoLines(service, domain),
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
    'orca worktree create --repo id:<repo> --parent-worktree "$POD_WORKSPACE_KEY" --name <slug>-<part> --agent claude --json',
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

function initiativePrompt(domain: AeDomainConfig, initiative: AeInitiative): string {
  const audience = initiative.stakeholderTeam ? ` for the ${initiative.stakeholderTeam} team` : ''
  return [
    `You are the main agent of the ${domain.name} domain, starting the initiative "${initiative.title}"${audience}.`,
    'Read INITIATIVE.md in this folder, then run `orca skills get ae-initiative` and follow that guide.',
    `Run \`orca domain show --domain ${domain.id} --json\` to see the repos and their roles (dbt, omni, other).`,
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

/** Pod: create the initiative folder, its INITIATIVE.md, a folder workspace under the domain, and the main agent's session. */
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
    throw new Error(`Domain "${input.domainId}" not found`)
  }
  const agent = input.agent ?? (domain.defaultAgent as TuiAgent | undefined) ?? DEFAULT_AGENT
  let initiative = service.saveInitiative({
    domainId: domain.id,
    title: input.title,
    stakeholderTeam: input.stakeholderTeam,
    repoIds: input.repoIds
  })
  mkdirSync(initiative.folderPath, { recursive: true })
  const markdownPath = join(initiative.folderPath, 'INITIATIVE.md')
  if (!existsSync(markdownPath)) {
    writeFileSync(markdownPath, renderInitiativeMarkdown(service, domain, initiative), 'utf8')
  }
  const runtime = service.runtimeService
  const workspace = await runtime.createFolderWorkspace({
    projectGroupId: domain.id,
    name: initiative.title,
    folderPath: initiative.folderPath,
    createdWithAgent: agent,
    creatorProvenance: { kind: 'host' }
  })
  initiative = service.saveInitiative({
    id: initiative.id,
    domainId: domain.id,
    title: initiative.title,
    coordinatorWorkspaceKey: `folder:${workspace.id}`
  })
  await runtime.createAgentSession({
    clientOperationId: operationId(),
    worktree: `id:folder:${workspace.id}`,
    agent,
    prompt: initiativePrompt(domain, initiative),
    promptDelivery: 'draft'
  })
  return initiative
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
  const workspace = await runtime.createFolderWorkspace({
    projectGroupId: domain.id,
    name: `${domain.name} main agent`,
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
