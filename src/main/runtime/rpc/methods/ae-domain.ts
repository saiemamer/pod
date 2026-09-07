import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'
import { getAeDomainService } from '../../../ae/domain-service'

const DomainSelector = z.object({
  domain: requiredString('Missing domain selector')
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
  })
]
