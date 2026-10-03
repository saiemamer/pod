# Installing Pod

Pod runs on macOS 12 (Monterey) or newer, on Apple silicon and Intel. It installs as `Pod.app` plus the `orca` command, which agents use to call Pod.

Pod and stock Orca share the `orca` command, `~/.orca` and `~/Library/Application Support/orca`. Install one of them on a Mac, not both; Homebrew refuses Pod while the `orca` cask is installed.

## Install with Homebrew

```sh
brew install --cask saiemamer/pod/pod
```

That installs the app into `/Applications` and links `orca` into Homebrew's bin folder (`/opt/homebrew/bin` on Apple silicon, `/usr/local/bin` on Intel). Pod builds are not signed with an Apple Developer ID, so the cask clears macOS's quarantine flag after every install and upgrade, and Pod opens on a normal double-click.

Check it worked:

```sh
orca --version
```

## Install from the DMG

Without Homebrew, download `pod-macos-arm64.dmg` (Apple silicon) or `pod-macos-x64.dmg` (Intel) from the [latest release](https://github.com/saiemamer/pod/releases/latest) and drag Pod into Applications. The first launch is blocked with "Pod cannot be opened because the developer cannot be verified", because the build is unsigned. To open it once and for good:

- macOS 14 and older: in Finder, right-click (or Control-click) Pod in Applications, choose Open, then Open again in the dialog.
- macOS 15 and newer, where right-click Open no longer skips the check: double-click Pod, close the warning, then open System Settings > Privacy & Security, scroll to Security, click "Open Anyway" next to the Pod message and confirm with your password.

The DMG does not put `orca` on your PATH; turn on the Shell command switch in Pod's Settings > General, CLI section, which links it into `/usr/local/bin` (or `~/.local/bin` where that folder is missing). A DMG install also has to be repeated by hand for every update, so prefer Homebrew.

## First setup

1. Settings > Analytics Tools > Tools: point Pod at `dbt`, the `omni` CLI and a Python with `sqlglot` (for column lineage). An empty field means Pod uses the one on your PATH. Pod downloads `dbt-language-server` itself unless you set a path.
2. Settings > Analytics Tools > dbt: the profiles directory, default target, and Core or Fusion.
3. Add your repositories as a domain: Add a project > Import repositories from folder, choose the folder that holds your dbt and Omni clones, and answer "Yes, import as group". Then open the group's menu > Domain settings… to check each repo's role (dbt, omni, infra), the stakeholder teams, and the env for agents (for example `OMNI_BASE_URL`). Put secrets such as `OMNI_API_KEY` under Secrets in that dialog: Pod encrypts them with a key kept in the macOS Keychain and decrypts them only to hand them to the agents and tools it runs for that domain.
4. The group's menu > New initiative… starts a coordinator agent for a piece of work across the domain's repos.

Optional: the dbt tools as an MCP server for Claude Code, set up from the same Tools page. See [`packages/pod-dbt-mcp/README.md`](../../packages/pod-dbt-mcp/README.md).

## Updates

When a release is out, Pod shows an update card with an "Update with Homebrew" button, which runs the upgrade in Terminal. Or run it yourself:

```sh
brew upgrade --cask pod
```

Quit and reopen Pod afterwards, then check `orca --version`. Pod cannot replace itself in place, because macOS only lets a signed app do that.

An update keeps your domains, initiatives, secrets and settings. They live in `~/Library/Application Support/orca`, which no install or upgrade touches; [`sync.md`](./sync.md) explains why that holds across upstream Orca updates too.

## Uninstall

```sh
brew uninstall --cask pod          # removes the app and the orca link, keeps your data
brew uninstall --zap --cask pod    # also deletes ~/.orca, ~/Library/Application Support/orca and Pod's caches
```

`--zap` deletes Orca's data too if you ever used stock Orca on the same Mac, since the two share those folders.
