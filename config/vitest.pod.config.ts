import { defineConfig, type TestProjectConfiguration } from 'vitest/config'
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
  'src/main/runtime/agent-state-rules/agent-state-rules-live-update.test.ts',
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

// Why: Pod wraps every macOS pane (its overlay key) so Orca's CLI PATH restore runs in plain
// panes too; this file's two bare-pane cases assert such a pane stays unwrapped.
// src/main/pod/pod-pane-wrap-env.test.ts covers Pod's behaviour in real shells.
const POD_BEHAVIOUR_TEST_EXCLUDES = ['src/main/ipc/pty-spawn-env-terminal-basics.test.ts']

const POD_EXCLUDE = [...UNIT_EXCLUDE, ...POD_IDENTITY_TEST_EXCLUDES, ...POD_BEHAVIOUR_TEST_EXCLUDES]

// Why src only: upstream's config/scripts and tests/ suites are contracts over its CI
// workflows, signing, and packaging pipeline, most of which Pod removed. Pod's own
// pipeline is verified by pod-release.yml producing an installable DMG.
// Why per project: upstream's projects set `extends: false`, so root include, exclude and env
// never reach them.
function scopeToPod(project: TestProjectConfiguration): TestProjectConfiguration {
  if (typeof project !== 'object' || !('test' in project) || !project.test) {
    return project
  }
  return {
    ...project,
    test: {
      ...project.test,
      include: project.test.include?.filter((pattern) => pattern.startsWith('src/')),
      exclude: [...(project.test.exclude ?? []), ...POD_EXCLUDE],
      // Why: upstream's CI jobs set it, and the browser-manager tests assert it before each case.
      env: { ...project.test.env, ORCA_BACKGROUND_LAUNCH: '1' }
    }
  }
}

export default defineConfig({
  ...upstreamConfig,
  test: {
    ...upstreamConfig.test,
    projects: upstreamConfig.test?.projects?.map(scopeToPod)
  }
})
