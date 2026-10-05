// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodUnreadableSettingNotice } from './PodUnreadableSettingNotice'
import type { PodUnreadableSetting } from '../../../shared/ae/pod-unreadable-types'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(
  setting: PodUnreadableSetting,
  value: string,
  unreadable: PodUnreadableSetting[]
) {
  const unreadableSecrets = vi.fn(async () => unreadable)
  Object.assign(window, { api: { ae: { settings: { unreadableSecrets } } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PodUnreadableSettingNotice setting={setting} value={value} />)
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

describe('PodUnreadableSettingNotice', () => {
  it('names the saved setting Pod could not read and asks for it again', async () => {
    const view = await render('httpProxyUrl', '', ['httpProxyUrl', 'opencodeGoApiKey'])

    const alert = view.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Pod could not read your saved proxy URL')
    expect(alert?.textContent).toContain('Enter it again here')
  })

  it('shows nothing for a setting Pod could read', async () => {
    const view = await render('browserKagiSessionLink', '', ['opencodeSessionCookie'])

    expect(view.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows nothing once the person has entered a new value', async () => {
    const view = await render('opencodeGoApiKey', 'sk-new', ['opencodeGoApiKey'])

    expect(view.querySelector('[role="alert"]')).toBeNull()
  })
})
