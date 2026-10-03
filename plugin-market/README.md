# dsh-plugin-market

English | [中文](README.zh.md)

**The plugin market inside DeepSeek Harness.** One entry at the foot of the sidebar opens a page
where you browse and search the community catalog, then install, update, enable, disable, and
remove plugins without leaving the GUI.

- Catalog comes from the curated [awesome-dsh-plugin](https://awesome-dsh-plugin.com/plugins.json)
  registry (4000+ entries, refreshed daily), read from the npm mirror first (the
  `dsh-plugin-catalog` package — measured at 0.3 s on this machine) with the origin as fallback
- Fetching, caching, retries, and degradation happen in the Host process; the browser only reads
  `/plugin-market`
- Installing and removing go through the official plugin-manager service (the same pnpm path and
  the same build-script approval rules as `dsh plugin add`)
- One package ships both the Host half and the Web client half, following the DeepSeek Harness
  plugin specification

## Install

```sh
# local directory (development / personal use)
dsh plugin --profile web add "E:\AI\DeepSeek Harness\Dsh\plugin-market"

# once published to npm
dsh plugin --profile web add dsh-plugin-market
```

Restart `dsh web` once (or let the desktop app recompose), refresh the page, and the entry appears.

On Windows you can install with a profile backup in one step:

```powershell
pwsh -File scripts\install-into-profile.ps1 -Profile desktop
pwsh -File scripts\install-into-profile.ps1 -Profile desktop -Rollback -BackupDir _verify\backup-desktop-<stamp>
```

## Where the entry is

The **bottom** of the sidebar, in the row above the account row (directly above Settings): a
full-width **Plugin Market** row, collapsing to an icon button in the 56px rail. Clicking it opens
the market page in the main column.

![Sidebar entry](assets/market-entry.png)

![Market page](assets/market-page.png)

## What you get

- **Browse and search** the catalog by name, author, and description (300 ms debounce), filter by
  category, sort by popular / newest / downloads / name, and page through results
- **Cards that answer the question**: name, author, stars, downloads, version, category, bilingual
  description; expand for the full description, capability tags, and repository/catalog links
- **One-click install** with a clear source, live progress, and an explicit result; when the plugin
  needs build scripts, the exact package names are shown before you approve
- **Installed management**: enable / disable through the profile patch layer (live when it can
  hot-load), uninstall with a second confirmation, and one-click update when a newer version exists
- **An honest catalog status**: source, entry count, and refresh time; when a refresh fails it says
  plainly that the data is the previous cache instead of pretending it is current
- **Errors that tell you what to do next**: what happened, why, and what to do now, plus a retry
- **Themes and languages**: colors come from host theme tokens only; copy follows the host locale
  (Chinese / English)

## Configuration

| Environment variable | Effect |
|---|---|
| `DSHM_REGISTRY_URL` | Points the market at your own catalog (any URL serving the same `plugins.json` shape). Once set it is the **only** source — no silent fallback |
| `DSHM_NPM_MIRROR` | Overrides the npm registry used to read the catalog (default order: `registry.npmmirror.com`, then `registry.npmjs.org`) |

Source order: the `dsh-plugin-catalog` npm package on the mirror, then the origin
`awesome-dsh-plugin.com/plugins.json`. The npm route comes first because the origin is served from
GitHub Pages, where a direct connection commonly times out after 25 s, while the mirror serves the
same file inside a 1.2 MB gzip tarball in a few hundred milliseconds — measured 289 ms against a
25 s timeout on this machine. dsh-market's own region routing makes the same choice.

## Security

- Only plugins present in the catalog can be installed; an explicit source outside it is refused
- Install/remove/toggle go exclusively through the Host `pluginManager` service — the plugin never
  runs a package manager itself and never edits profile files directly
- Mutating routes accept same-origin POST only, with a 64 KiB body limit
- The market refuses to uninstall itself and points at the official terminal command instead
- Catalog fetching is GET-only, carries no credentials, and writes nothing to disk

## Known limitations

- Web and desktop profiles only (a headless profile gets the Host half alone)
- Changes that require a restart are reported honestly; no automatic restart helper
- No bundled catalog snapshot: when fetching fails the market reports the failure rather than
  serving stale data (a plugin published today must not read as "does not exist")
- No favorites, notes, groups, backup/restore, theme market, or comments (see
  `docs/PLUGIN-MARKET.md` §7)

## Development and verification

- Interface contract: `docs/API-CONTRACT.md`
- Design and specification mapping: `docs/PLUGIN-MARKET.md`
- Verification report: `verify/REPORT.md`, entry point `scripts/verify-market.ps1`

```sh
node --check plugin-market/lib/index.js
node --check plugin-market/lib/client.js
```

## License

MIT. Catalog data remains the property of
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
