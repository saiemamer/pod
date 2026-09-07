import { defineConfig } from 'vitest/config'
import upstreamConfig from './vitest.config'

// Why: these need a live shell, node-pty, or a real Chrome; upstream's unit-tests.yml
// excludes the same files on its runners.
const UPSTREAM_CI_EXCLUDES = [
  'src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts',
  'src/main/daemon/shell-ready.test.ts',
  'src/main/daemon/node-pty-fd-leak.test.ts',
  'src/main/providers/local-pty-shell-ready-zsh-launch-environment.test.ts',
  'src/main/providers/__tests__/shell-ready-framework-example.test.ts',
  'src/main/pty/omp-shell-wrapper.node-pty.test.ts',
  'src/main/shell-startup-feature-channel.test.ts',
  'src/main/terminal-history-fish-session.node-pty.test.ts',
  'src/main/zsh-scoped-histfile.live-shell.test.ts',
  'src/main/zsh-startup-hook-user-config-equivalence.live-shell.test.ts',
  'src/main/zsh-wrapper-version-mismatch.live-shell.test.ts',
  'src/renderer/src/components/terminal-pane/fish-color-scheme-child-stdin.node-pty.test.ts',
  'src/shared/fish-query-reply-child-stdin.node-pty.test.ts',
  'src/shared/pty-reply-echo-shapes.node-pty.test.ts',
  'src/shared/startup-shell-portability.live-shell.test.ts',
  'src/shared/posix-command-path-lookup.test.ts'
]

// Why: these assert Orca's own bundle id, release repository, or feed URLs, which Pod
// replaces through src/shared/brand.ts (see FORK_TOUCHPOINTS.md). Upstream CI keeps
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
  'src/main/updater.publishing-window-feed.test.ts',
  'src/renderer/src/components/UpdateCard.error-card.test.tsx',
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
    exclude: [
      ...(upstreamConfig.test?.exclude ?? []),
      ...UPSTREAM_CI_EXCLUDES,
      ...POD_IDENTITY_TEST_EXCLUDES,
      ...POD_MOVED_WORKFLOW_TEST_EXCLUDES,
      ...UPSTREAM_RED_AT_BASE_TAG_EXCLUDES
    ]
  }
})
