// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomainSecretsSection } from './DomainSecretsSection'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setAeDomainSecret: vi.fn(), removeAeDomainSecret: vi.fn() })
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(secretNames: string[], unreadable: string[]) {
  const unreadableSecrets = vi.fn(async () => unreadable)
  Object.assign(window, { api: { ae: { domains: { unreadableSecrets } } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <DomainSecretsSection domainId="g1" secretNames={secretNames} ensureDomain={async () => {}} />
    )
  })
  return { view: container, unreadableSecrets }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  Reflect.deleteProperty(window, 'api')
})

describe('DomainSecretsSection with a secret Pod cannot read', () => {
  it('names it and asks for the value again where secrets are entered', async () => {
    const { view, unreadableSecrets } = await render(
      ['OMNI_API_KEY', 'DBT_TOKEN'],
      ['OMNI_API_KEY']
    )

    expect(unreadableSecrets).toHaveBeenCalledWith({ domainId: 'g1' })
    const alert = view.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Pod could not read OMNI_API_KEY')
    expect(alert?.textContent).toContain('Enter the value again below and click Add')
    // The chip stays, so the sealed value is still listed until a new one replaces it.
    expect(view.textContent).toContain('DBT_TOKEN')
  })

  it('says nothing when every secret reads', async () => {
    const { view } = await render(['DBT_TOKEN'], [])

    expect(view.querySelector('[role="alert"]')).toBeNull()
  })
})
