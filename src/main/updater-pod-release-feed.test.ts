import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POD_RELEASES_URL } from '../shared/brand'
import {
  fetchNewerReleaseTagsWithReadiness,
  getReleaseDownloadUrl
} from './updater-prerelease-feed'
import { resolveTargetBuild } from './updater-release-builds'

const { netFetchMock, netRequestMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  netRequestMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: netRequestMock }
}))

function buildAtomFeed(releasesUrl: string, tags: string[]): string {
  const entries = tags
    .map((tag) => `<entry><link rel="alternate" href="${releasesUrl}/tag/${tag}"/></entry>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed>${entries}</feed>`
}

function respondWithAtom(atom: string): void {
  netFetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith('.atom')
        ? { ok: true, status: 200, text: () => Promise.resolve(atom) }
        : { ok: false, status: 404, text: () => Promise.resolve('') }
    )
  )
}

describe('Pod release feed', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    netRequestMock.mockReset()
  })

  it('downloads release assets from the Pod releases page', () => {
    expect(getReleaseDownloadUrl('v0.1.0')).toBe(`${POD_RELEASES_URL}/download/v0.1.0`)
    expect(resolveTargetBuild('stable', 'v0.1.0').feedUrl).toBe(
      `${POD_RELEASES_URL}/download/v0.1.0`
    )
  })

  it('reads release tags from the Pod atom feed', async () => {
    respondWithAtom(buildAtomFeed(POD_RELEASES_URL, ['v0.2.0']))
    const result = await fetchNewerReleaseTagsWithReadiness('0.1.0', 1)
    expect(netFetchMock).toHaveBeenCalledWith(`${POD_RELEASES_URL}.atom`, expect.anything())
    // Why not-ready: the manifest probes 404 above; what matters is that the tag was parsed.
    expect(result.state).toBe('not-ready')
  })

  it('ignores tags that link to the upstream Orca repository', async () => {
    respondWithAtom(buildAtomFeed('https://github.com/stablyai/orca/releases', ['v9.9.9']))
    const result = await fetchNewerReleaseTagsWithReadiness('0.1.0', 1)
    expect(result).toEqual({ tags: [], state: 'no-newer' })
  })
})
