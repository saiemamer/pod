import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getRequiredStringFlag } from '../flags'
import {
  formatDomainList,
  formatDomainShow,
  type DomainListResult,
  type DomainShowResult
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
  }
}
