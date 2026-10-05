// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  POD_START_NOTICE_TOAST_ID,
  PodStartNoticeHost,
  podStartNoticeItems
} from './PodStartNoticeHost'
import type { PodStartNoticeContent } from '../../../shared/ae/pod-unreadable-types'

type ToastOptions = {
  id: string
  description: React.ReactNode
  action: { label: string; onClick: () => void }
}

const toastWarning = vi.hoisted(() => vi.fn<(title: string, options: ToastOptions) => void>())
vi.mock('sonner', () => ({ toast: { warning: toastWarning } }))

const initialAppState = useAppStore.getInitialState()
let root: Root | null = null
let container: HTMLDivElement | null = null

const EMPTY: PodStartNoticeContent = { credentials: [], domainSecrets: [], settings: [] }

async function render(content: PodStartNoticeContent | null) {
  const take = vi.fn(async () => content)
  Object.assign(window, { api: { ae: { startNotice: { take } } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PodStartNoticeHost />)
  })
  return take
}

function shownToast(): { title: string; options: ToastOptions } {
  expect(toastWarning).toHaveBeenCalledOnce()
  const [title, options] = toastWarning.mock.calls[0]
  return { title, options }
}

beforeEach(() => {
  useAppStore.setState(initialAppState, true)
  toastWarning.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  Reflect.deleteProperty(window, 'api')
  useAppStore.setState(initialAppState, true)
})

describe('podStartNoticeItems', () => {
  it('names each value from every source in plain words, credentials first', () => {
    const items = podStartNoticeItems({
      credentials: ['linear', 'openai-speech'],
      domainSecrets: [
        { domainId: 'g1', domainName: 'pod-smoke', secretNames: ['DBT_TOKEN', 'OMNI_KEY'] }
      ],
      settings: ['httpProxyUrl', 'opencodeGoApiKey']
    })

    expect(items.map((item) => item.text)).toEqual([
      'Linear credentials',
      'OpenAI speech credentials',
      'DBT_TOKEN, OMNI_KEY in the pod-smoke domain',
      'Proxy URL',
      'OpenCode Go API key'
    ])
    expect(items.map((item) => item.target)).toEqual([
      { kind: 'settings', pane: 'integrations', screen: 'Integrations' },
      { kind: 'settings', pane: 'voice', screen: 'Voice' },
      { kind: 'domain', domainId: 'g1', domainName: 'pod-smoke' },
      { kind: 'settings', pane: 'advanced', screen: 'Advanced' },
      { kind: 'settings', pane: 'accounts', screen: 'Accounts' }
    ])
  })
})

describe('PodStartNoticeHost', () => {
  it('shows one lasting notice whose button opens the Settings screen of the first value', async () => {
    const openSettingsPage = vi.fn()
    const openSettingsTarget = vi.fn()
    useAppStore.setState({ openSettingsPage, openSettingsTarget })

    await render({ ...EMPTY, credentials: ['jira'], settings: ['browserKagiSessionLink'] })

    const { title, options } = shownToast()
    expect(title).toBe('Pod could not read some saved values')
    expect(options.id).toBe(POD_START_NOTICE_TOAST_ID)
    const description = document.createElement('div')
    const descriptionRoot = createRoot(description)
    act(() => descriptionRoot.render(<>{options.description}</>))
    expect(description.textContent).toContain('Jira credentials')
    expect(description.textContent).toContain('Kagi session link')
    act(() => descriptionRoot.unmount())

    expect(options.action.label).toBe('Open Integrations settings')
    options.action.onClick()
    expect(openSettingsPage).toHaveBeenCalledOnce()
    expect(openSettingsTarget).toHaveBeenCalledWith({ pane: 'integrations', repoId: null })
  })

  it('opens Domain settings, and the projects list it mounts from, when a domain secret comes first', async () => {
    const openAeDialog = vi.fn()
    useAppStore.setState({ openAeDialog, sidebarOpen: false, sidebarBody: 'agents' })

    await render({
      ...EMPTY,
      domainSecrets: [{ domainId: 'g1', domainName: 'pod-smoke', secretNames: ['DBT_TOKEN'] }]
    })

    const { options } = shownToast()
    expect(options.action.label).toBe('Open Domain settings')
    options.action.onClick()
    expect(useAppStore.getState().sidebarOpen).toBe(true)
    expect(useAppStore.getState().sidebarBody).toBe('workspaces')
    expect(openAeDialog).toHaveBeenCalledWith({
      kind: 'domain-settings',
      groupId: 'g1',
      label: 'pod-smoke'
    })
  })

  it('shows nothing when main has nothing to list or showed it before', async () => {
    const take = await render(null)

    expect(take).toHaveBeenCalledOnce()
    expect(toastWarning).not.toHaveBeenCalled()
  })
})
