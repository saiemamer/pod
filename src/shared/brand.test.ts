import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  POD_APP_ID,
  POD_PRODUCT_NAME,
  POD_RELEASE_REPO,
  POD_RELEASES_URL,
  POD_UPSTREAM_BASE_TAG
} from './brand'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from './local-build-compatibility-contract'
import {
  RELEASE_CHANNELS,
  getReleaseNotesUrlForVersion,
  getReleaseRepoForChannel
} from './release-channel'

// Why: electron-builder reads the CommonJS mirror, so the two files drifting apart ships a
// DMG whose bundle id or feed differs from what the running app expects.
// Why cwd: vitest runs from the repo root, and this file compiles to CommonJS, where
// import.meta is not allowed.
const repoRoot = process.cwd()
const require = createRequire(resolve(repoRoot, 'package.json'))
const podBrand = require(resolve(repoRoot, 'config/pod-brand.cjs')) as {
  productName: string
  appId: string
  releaseOwner: string
  releaseRepo: string
  upstreamBaseTag: string
}

describe('Pod brand', () => {
  it('keeps src/shared/brand.ts and config/pod-brand.cjs in sync', () => {
    expect(podBrand.productName).toBe(POD_PRODUCT_NAME)
    expect(podBrand.appId).toBe(POD_APP_ID)
    expect(`${podBrand.releaseOwner}/${podBrand.releaseRepo}`).toBe(POD_RELEASE_REPO)
    expect(podBrand.upstreamBaseTag).toBe(POD_UPSTREAM_BASE_TAG)
    expect(POD_UPSTREAM_BASE_TAG).toMatch(/^v\d+\.\d+\.\d+$/)
  })

  // Why: GitHub runs every file under .github/workflows. Upstream's live in
  // .github/workflows-upstream so their edits still apply on rebase; a rebase that
  // brings a new upstream workflow into the live folder must move it too.
  it('keeps only Pod workflows in .github/workflows', () => {
    const workflowsDir = resolve(repoRoot, '.github/workflows')
    const stray = readdirSync(workflowsDir).filter((name) => !name.startsWith('pod-'))
    expect(stray).toEqual([])
  })

  it('points every release channel and the release notes at the Pod repository', () => {
    for (const channel of RELEASE_CHANNELS) {
      expect(getReleaseRepoForChannel(channel)).toBe(POD_RELEASE_REPO)
    }
    expect(getReleaseNotesUrlForVersion('0.1.0')).toBe(`${POD_RELEASES_URL}/tag/v0.1.0`)
    expect(getReleaseNotesUrlForVersion(null)).toBe(POD_RELEASES_URL)
  })

  it('keys the local-build contract on the Pod bundle id', () => {
    expect(LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId).toBe(POD_APP_ID)
  })
})
