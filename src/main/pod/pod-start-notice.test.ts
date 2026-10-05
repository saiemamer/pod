import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { START_NOTICE_SHOWN_FILE, takePodStartNotice } from './pod-start-notice'

let userDataDir: string

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'pod-start-notice-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function sources(overrides: Partial<Parameters<typeof takePodStartNotice>[0]> = {}) {
  return {
    userDataDir,
    credentials: () => [],
    domainSecrets: () => [],
    settings: () => [],
    now: new Date('2026-10-05T12:00:00Z'),
    ...overrides
  }
}

describe('takePodStartNotice', () => {
  it('lists what every source reports, leaving out domains with nothing unreadable', () => {
    const content = takePodStartNotice(
      sources({
        credentials: () => ['linear', 'minimax'],
        domainSecrets: () => [
          { domainId: 'g1', domainName: 'pod-smoke', secretNames: ['DBT_TOKEN'] },
          { domainId: 'g2', domainName: 'finance', secretNames: [] }
        ],
        settings: () => ['httpProxyUrl']
      })
    )

    expect(content).toEqual({
      credentials: ['linear', 'minimax'],
      domainSecrets: [{ domainId: 'g1', domainName: 'pod-smoke', secretNames: ['DBT_TOKEN'] }],
      settings: ['httpProxyUrl']
    })
    const record: unknown = JSON.parse(
      readFileSync(join(userDataDir, START_NOTICE_SHOWN_FILE), 'utf8')
    )
    expect(record).toEqual({ shownAt: '2026-10-05T12:00:00.000Z' })
  })

  it('answers once: a second start gets nothing and asks no source', () => {
    expect(takePodStartNotice(sources({ settings: () => ['browserKagiSessionLink'] }))).not.toBe(
      null
    )
    const credentials = vi.fn(() => ['jira' as const])

    expect(takePodStartNotice(sources({ credentials }))).toBeNull()
    expect(credentials).not.toHaveBeenCalled()
  })

  it('shows nothing and records nothing when every value reads, as on a fresh install', () => {
    expect(
      takePodStartNotice(
        sources({
          domainSecrets: () => [{ domainId: 'g1', domainName: 'pod-smoke', secretNames: [] }]
        })
      )
    ).toBeNull()
    expect(existsSync(join(userDataDir, START_NOTICE_SHOWN_FILE))).toBe(false)

    // A later start that finds an unreadable value still gets the notice.
    expect(takePodStartNotice(sources({ credentials: () => ['bitbucket'] }))?.credentials).toEqual([
      'bitbucket'
    ])
  })
})
