// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodCredentialsLeftBehindNotice } from './PodCredentialsLeftBehindNotice'
import type { PodCredentialService } from '../../../shared/ae/pod-unreadable-types'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(services: PodCredentialService[], leftBehind: PodCredentialService[]) {
  const leftBehindCall = vi.fn(async () => leftBehind)
  Object.assign(window, { api: { ae: { credentials: { leftBehind: leftBehindCall } } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PodCredentialsLeftBehindNotice services={services} />)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  Reflect.deleteProperty(window, 'api')
})

describe('PodCredentialsLeftBehindNotice', () => {
  it('asks in plain words for each credential of this pane that stayed behind', async () => {
    const view = await render(['linear', 'jira', 'bitbucket'], ['linear', 'jira', 'minimax'])

    const alert = view.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(
      'Pod could not bring over your saved Linear, Jira credentials'
    )
    expect(alert?.textContent).toContain('Connect Linear, Jira again below')
    expect(alert?.textContent).not.toContain('MiniMax')
  })

  it('shows nothing once every credential of this pane is saved again', async () => {
    const view = await render(['openai-speech'], ['minimax'])

    expect(view.querySelector('[role="alert"]')).toBeNull()
  })
})
