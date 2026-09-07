import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  formatDomainList,
  formatDomainShow,
  formatInitiativeUpdate,
  type DomainListResult,
  type DomainShowResult,
  type InitiativeUpdateResult
} from '../ae-domain-format'

export const DOMAIN_HANDLERS: Record<string, CommandHandler> = {
  'domain list': async ({ client, json }) => {
    const result = await client.call<DomainListResult>('domain.list')
    printResult(result, json, formatDomainList)
  },
  'domain show': async ({ flags, client, json }) => {
    const result = await client.call<DomainShowResult>('domain.show', {
      domain: getRequiredStringFlag(flags, 'domain')
    })
    printResult(result, json, formatDomainShow)
  },
  'domain initiative-update': async ({ flags, client, json }) => {
    const result = await client.call<InitiativeUpdateResult>('domain.initiativeUpdate', {
      initiative: getRequiredStringFlag(flags, 'initiative'),
      run: getOptionalStringFlag(flags, 'run'),
      status: getOptionalStringFlag(flags, 'status')
    })
    printResult(result, json, formatInitiativeUpdate)
  }
}
