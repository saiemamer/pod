import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString, requiredString } from '../schemas'
import { getAeDomainService } from '../../../ae/domain-service'
import { AE_INITIATIVE_STATUSES, type AeInitiativeStatus } from '../../../../shared/ae/domain-types'

const DomainSelector = z.object({
  domain: requiredString('Missing domain selector')
})

const InitiativeUpdateParams = z.object({
  initiative: requiredString('Missing initiative id'),
  run: OptionalString,
  status: OptionalString
})

/** Pod: read-only domain surface for agents and scripts; secrets are names only. */
export const DOMAIN_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'domain.list',
    params: null,
    handler: () => {
      const service = getAeDomainService()
      return { domains: service.listDomains(), initiatives: service.listInitiatives() }
    }
  }),
  defineMethod({
    name: 'domain.show',
    params: DomainSelector,
    handler: (params) => {
      const service = getAeDomainService()
      const wanted = params.domain.trim().toLowerCase()
      const domain = service
        .listDomains()
        .find((entry) => entry.id === params.domain || entry.name.toLowerCase() === wanted)
      if (!domain) {
        throw new Error(`Domain "${params.domain}" not found`)
      }
      return { domain, initiatives: service.listInitiatives(domain.id) }
    }
  }),
  defineMethod({
    name: 'domain.initiativeUpdate',
    params: InitiativeUpdateParams,
    handler: (params) => {
      const service = getAeDomainService()
      const existing = service.listInitiatives().find((entry) => entry.id === params.initiative)
      if (!existing) {
        throw new Error(`Initiative "${params.initiative}" not found`)
      }
      if (params.status && !AE_INITIATIVE_STATUSES.includes(params.status as AeInitiativeStatus)) {
        throw new Error(`Invalid --status; use one of ${AE_INITIATIVE_STATUSES.join(', ')}`)
      }
      const initiative = service.saveInitiative({
        id: existing.id,
        domainId: existing.domainId,
        title: existing.title,
        ...(params.run ? { runId: params.run } : {}),
        ...(params.status ? { status: params.status as AeInitiativeStatus } : {})
      })
      return { initiative }
    }
  })
]
