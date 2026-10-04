import { defineConfig } from 'vitest/config'
import upstreamConfig from './vitest.config'
// Why: upstream applies this list only on its balanced CI shards; it holds the tests that need
// a live shell, node-pty, or a real Chrome.
import { UNIT_EXCLUDE } from './scripts/ci-unit-files.mjs'

// Why: these assert Orca's own bundle id, release repository, or feed URLs, which Pod
// replaces through src/shared/brand.ts, or the exact version line, which Pod suffixes with
// its Orca base tag (see FORK_TOUCHPOINTS.md). Upstream CI keeps
// covering the logic at the tag Pod is rebased onto; src/shared/brand.test.ts and
// src/main/updater-pod-release-feed.test.ts cover the substituted values.
const POD_IDENTITY_TEST_EXCLUDES = [
  'src/main/local-builds/local-build-candidate.test.ts',
  'src/main/local-builds/local-build-compatibility-contract.test.ts',
  'src/main/macos-press-and-hold-default.defaults-domain.test.ts',
  'src/main/macos-press-and-hold-default.test.ts',
  'src/main/macos-tcc-prompt-watch.test.ts',
  'src/main/updater-prerelease-feed-readiness.test.ts',
  'src/main/updater-prerelease-feed.test.ts',
  'src/main/updater-release-builds.test.ts',
  'src/main/updater.build-channel-selection.test.ts',
  'src/main/updater.check-failure.test.ts',
  'src/main/updater.feed-attempt-lifetime.test.ts',
  'src/main/updater.publishing-window-feed.test.ts',
  'src/renderer/src/components/UpdateCard.error-card.test.tsx',
  'src/renderer/src/components/settings/GeneralPane.section-lifetime.test.tsx',
  'src/shared/local-build-compatibility.test.ts',
  'src/shared/release-channel.test.ts'
]

// Why: these read upstream workflow files, which Pod keeps in .github/workflows-upstream.
const POD_MOVED_WORKFLOW_TEST_EXCLUDES = ['src/shared/windows-lane-tree-removal-boundary.test.ts']

// Why: red on the untouched upstream tree at the base tag (11 failures at v1.4.197 on
// macOS and ubuntu runners). Re-run them after each rebase and drop them once green.
const UPSTREAM_RED_AT_BASE_TAG_EXCLUDES = [
  'src/main/artifacts/artifact-cloud-recovery.test.ts',
  'src/main/artifacts/artifact-cloud-service-races.test.ts',
  'src/main/artifacts/artifact-cloud-service.test.ts'
]

// Why src only: upstream's config/scripts and tests/ suites are contracts over its CI
// workflows, signing, and packaging pipeline, most of which Pod removed. Pod's own
// pipeline is verified by pod-release.yml producing an installable DMG.
export default defineConfig({
  ...upstreamConfig,
  test: {
    ...upstreamConfig.test,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Why: upstream's CI jobs set it, and the browser-manager tests assert it before each case.
    env: { ...upstreamConfig.test?.env, ORCA_BACKGROUND_LAUNCH: '1' },
    exclude: [
      ...UNIT_EXCLUDE,
      ...POD_IDENTITY_TEST_EXCLUDES,
      ...POD_MOVED_WORKFLOW_TEST_EXCLUDES,
      ...UPSTREAM_RED_AT_BASE_TAG_EXCLUDES
    ]
  }
})
