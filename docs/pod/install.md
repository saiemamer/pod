# Installing Pod

Pod runs on macOS 12 (Monterey) or newer, on Apple silicon and Intel. It installs as `Pod.app` plus the `pod` command. Inside the terminals Pod opens, the same CLI is also `orca`, which is the name Pod's agents, skills and the coordinator use.

Pod and stock Orca can be installed on the same Mac. Pod keeps its data in `~/Library/Application Support/Pod`, apart from stock Orca's `~/Library/Application Support/orca`. It keeps its Linear, Jira, Bitbucket, OpenAI speech and MiniMax credentials in `~/.pod`, apart from Orca's `~/.orca`, and encrypts secrets with its own Keychain item, `Pod Safe Storage`, so macOS never asks for your password to let Pod open Orca's `orca Safe Storage`. Its shell command is `pod`, so `orca` outside Pod stays stock Orca's, and `orca://` links open stock Orca. The two still share the rest of `~/.orca`: hook scripts, keybindings and the agent-teams shim, none of them encrypted.

## Install with Homebrew

```sh
brew install --cask saiemamer/pod/pod
```

That installs the app into `/Applications` and links `pod` into Homebrew's bin folder (`/opt/homebrew/bin` on Apple silicon, `/usr/local/bin` on Intel). Pod builds are not signed with an Apple Developer ID, so the cask clears macOS's quarantine flag after every install and upgrade, and Pod opens on a normal double-click.

Check it worked:

```sh
pod --version
```

## Install from the DMG

Without Homebrew, download `pod-macos-arm64.dmg` (Apple silicon) or `pod-macos-x64.dmg` (Intel) from the [latest release](https://github.com/saiemamer/pod/releases/latest) and drag Pod into Applications. The first launch is blocked with "Pod cannot be opened because the developer cannot be verified", because the build is unsigned. To open it once and for good:

- macOS 14 and older: in Finder, right-click (or Control-click) Pod in Applications, choose Open, then Open again in the dialog.
- macOS 15 and newer, where right-click Open no longer skips the check: double-click Pod, close the warning, then open System Settings > Privacy & Security, scroll to Security, click "Open Anyway" next to the Pod message and confirm with your password.

The DMG does not put `pod` on your PATH; turn on the Shell command switch in Pod's Settings > General, CLI section, which links it into `/usr/local/bin` (or `~/.local/bin` where that folder is missing). A DMG install also has to be repeated by hand for every update, so prefer Homebrew.

## First setup

Pod needs one choice from you: your dbt repo. On first start the landing page offers **Choose your dbt repo**; pick the folder and Pod does the rest. It reads the repo, runs `--version` on the tools it finds (nothing that can reach the warehouse or Omni), and when nothing needs a decision it sets everything up at once and shows what it set up. The same setup runs from Settings > Analytics Tools > Tools > **Set up from repos**, from the **Set up this repo** button in the Omni tab or the dbt connection view of a repo that is not set up yet, and from the offer Pod shows when you add a project that holds a dbt project or an Omni model.

Pod asks only where it cannot choose safely:

- The profile's default target looks like production (`prod`, `production`, `prd`, `live`), or the profile names none: pick the target Pod runs against.
- The repo holds more than one dbt project: pick the one to use.
- No dbt that runs was found: give the path of the one you use (`which dbt` in your terminal prints it), or set up without dbt for now.

What Pod finds, in order:

- **dbt**: a virtual environment in or beside the repo (`.venv`, `venv`, `env`), then every `dbt` on your shell's PATH in order, then each pyenv Python. The first one that answers `dbt --version` wins. A broken one is skipped, and the summary says where it is and why it does not start (for example, that the Python it was installed with no longer exists). Core or Fusion comes from the same answer. When the dbt field in Settings is empty, dbt commands use the same rule, looked up once per session.
- **dbt project and profile**: the `dbt_project.yml` at the repo root or one level down, and its `profile:`.
- **Profiles folder**: `DBT_PROFILES_DIR`, the project folder, `local_profiles/`, `profiles/` and `.dbt/` in the repo, then `~/.dbt`. Pod reads only the profile's target names from `profiles.yml`, never its credentials.
- **Default target**: the profile's own `target:`, unless it looks like production.
- **Omni CLI and sign-in**: `omni` on your shell's PATH. The Omni CLI signs in with a profile made by `omni config init` (an API key or a browser sign-in) or `omni config login`, kept in `~/.config/omni-cli/config.json` on macOS too, or with an `OMNI_API_TOKEN`; Pod needs no API key when the CLI is already signed in. `OMNI_BASE_URL` from your shell goes into the domain's env. When the CLI reports a sign-in problem, the Omni panel says so in plain words, with the CLI's own text under Details.
- **Python with sqlglot** for column lineage. Pod ships its own copy of sqlglot, so any Python 3.9 or later works: the one in Settings, else the one that runs dbt, else `python3` on PATH. Only with no Python at all does column lineage match columns by name.

Setup creates the domain: a project group named after the dbt repo, with each repo's role read from its files (a folder with no Omni model joins as `other`). The group's folder is the one above the dbt repo, unless that is your home folder or a disk root; then the group has no folder and initiative notes go to `~/Pod/<group>`. Setup stores the profiles folder and target as the domain's dbt defaults, and sets the dbt, omni and Python paths and Core or Fusion in Settings. Your Omni repo can be added from the result screen or later; running setup again with the same answers changes nothing. The group's menu > New initiative… then starts a coordinator agent for a piece of work across the domain's repos.

### Setting it up by hand

If setup misses something, set it directly:

1. Settings > Analytics Tools > Tools: point Pod at `dbt`, the `omni` CLI and, if you want a particular one, a Python 3.9 or later (Pod brings sqlglot). An empty field means Pod finds one the way setup does. Pod downloads `dbt-language-server` itself unless you set a path.
2. Settings > Analytics Tools > dbt: the profiles directory, default target, and Core or Fusion.
3. Add your repositories as a domain: Add a project > Import repositories from folder, choose the folder that holds your dbt and Omni clones, and answer "Yes, import as group". Then open the group's menu > Domain settings… to check each repo's role (dbt, omni, infra), the stakeholder teams, and the env for agents (for example `OMNI_BASE_URL`). Put secrets such as `OMNI_API_KEY` under Secrets in that dialog: Pod encrypts them with a key kept in the macOS Keychain and decrypts them only to hand them to the agents and tools it runs for that domain. A key is needed only when the Omni CLI has no profile of its own.

Optional: the dbt tools as an MCP server for Claude Code, set up from the same Tools page. See [`packages/pod-dbt-mcp/README.md`](../../packages/pod-dbt-mcp/README.md).

## Updates

When a release is out, Pod shows an update card with an "Update with Homebrew" button, which runs the upgrade in Terminal. Or run it yourself:

```sh
brew upgrade --cask pod
```

Quit and reopen Pod afterwards, then check `pod --version`. Pod cannot replace itself in place, because macOS only lets a signed app do that.

An update keeps your domains, initiatives, secrets and settings. They live in `~/Library/Application Support/Pod`, which no install or upgrade touches; [`sync.md`](./sync.md) explains why that holds across upstream Orca updates too.

Pod 0.1.12 and older kept that data in `~/Library/Application Support/orca`. The first start after upgrading copies it into `Pod` once. Quit the old Pod (and stock Orca, if it is installed) before opening the new one; Pod refuses to start while either still has the old folder open. The first start also stops the old Pod's terminal daemon, so any terminal sessions it still hosts end. If stock Orca has never been on the Mac, the old folder is then renamed to `orca.moved-to-pod-<date>`; otherwise it stays where it is for Orca.

Pod 0.1.14 and older encrypted secrets with Orca's Keychain item, `orca Safe Storage`; later versions use `Pod Safe Storage`, and Pod never reads Orca's item. So the first start after that upgrade cannot read the secrets an older Pod or stock Orca saved, and asks for each one again instead of asking macOS for your password:

- It copies the unencrypted credential files from `~/.orca` into `~/.pod` once and leaves the encrypted tokens in `~/.orca`, unchanged. Settings > Integrations then asks you to connect Linear, Jira or Bitbucket again, Settings > Voice asks for the OpenAI speech key, and the MiniMax section of Settings > Accounts asks for MiniMax.
- A domain secret Pod cannot read is named in that domain's settings, above the secrets form. Agents start without it until you enter the value again and click Add; the old encrypted value stays until then.
- Other encrypted settings, such as the OpenCode session cookie or a proxy URL with a password, need entering again too, and Pod does not point these out yet.

Your domains, repos, initiatives and every unencrypted setting carry over unchanged.

## Uninstall

```sh
brew uninstall --cask pod          # removes the app and the pod link, keeps your data
brew uninstall --zap --cask pod    # also deletes ~/Library/Application Support/Pod and Pod's caches
```

`--zap` leaves `~/.orca`, which stock Orca shares, and any `orca.moved-to-pod-<date>` folder from the first upgrade. Pod's credentials sit in `~/.pod`; delete that folder by hand for a clean slate.
