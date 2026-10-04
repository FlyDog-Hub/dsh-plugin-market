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

# from the GitHub Release asset (substitute the current release's version; this package is not on npm)
dsh plugin --profile web add https://github.com/Winnie-0721/dsh-plugin-market/releases/download/v1.1.1/dsh-plugin-market-1.1.1.tgz
```

Restart `dsh web` once (or let the desktop app recompose), refresh the page, and the entry appears.
After that first install you do not need the command again: the market's own **Check for updates**
button does exactly this (the GitHub Releases API and the jsDelivr CDN, with three verification
checks, and it asks you to restart DSH once when it is done).

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
  hot-load), uninstall with a second confirmation, and a per-plugin update when a newer version exists
- **Update hints, confirmed one at a time** (v1.1.0): the header's "Plugin updates" button carries a
  count badge, and so does the sidebar entry; opening it lists every outdated plugin with its own
  "Update to x.y.z". There is deliberately **no update-all**: each click changes one dependency, so a
  failure cannot take the others down and you can see exactly which package moved
- **Update the market itself** (v1.1.0): "Check for updates" turns into "Update to x.y.z" when a newer
  release exists, downloads it, verifies it, and hands it to the Host — then asks for a **DSH restart**
  (the Host half is cached in the running process, so the button never claims it already took effect)
- **An honest catalog status**: source, entry count, and refresh time; when a refresh fails it says
  plainly that the data is the previous cache instead of pretending it is current
- **Errors that tell you what to do next**: what happened, why, and what to do now, plus a retry
- **Themes and languages**: colors come from host theme tokens only; copy follows the host locale
  (Chinese / English)
- **Restrained motion** (v1.1.0): staggered card entry, hover lift, button press rebound, a sliding tab
  underline, notices that slide in with a countdown line, the update list expanding in place, and an
  indeterminate progress bar during any write. With the system's "reduce motion" setting everything is
  turned off and the content still renders complete — verified in a real browser, not just in code

![The two new header buttons and the expanded update list](assets/market-updates.png)

![Header toolbar: Plugin updates (with badge) / Check for updates / Refresh catalog](assets/market-header-actions.png)

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
- Mutating routes accept only requests carrying trusted origin evidence: the desktop shell's
  `dsh-app://app` origin, a same-origin `Origin`, or a loopback client with no origin headers at all
  (the desktop shell strips them while forwarding). Cross-site `Origin` and
  `Sec-Fetch-Site: cross-site` are always refused, and the body limit is 64 KiB
- The market refuses to uninstall itself and points at the official terminal command instead
- Catalog fetching is GET-only, carries no credentials, and writes nothing to disk
- **Self-update tries three sources by freshness**: the GitHub Releases API (authoritative, but
  anonymous calls are rate-limited to 60/hour) → the jsDelivr tag list → the `@main`
  `releases/index.json`; when all three lag or are limited, it probes three candidate tags as a
  bounded fallback (any tag is fetched on demand, which is what catches a just-published release).
  The artifact is fetched from `@<tag>` → `@main` → the GitHub Release asset, and verified three
  ways: the path must be `releases/*.tgz`, the `sha256` must match `releases/index.json`, and the
  tarball must declare the expected package name and version. **This does not stop a swapped
  manifest plus artifact** — that needs an independent signing key, which does not exist yet. The
  channel also requires the repository to stay public; if it goes private the button reports
  "no update channel answered"

## Known limitations

- Web and desktop profiles only (a headless profile gets the Host half alone)
- Changes that require a restart are reported honestly; no automatic restart helper (a self-update
  install also needs one restart)
- No bundled catalog snapshot: when fetching fails the market reports the failure rather than
  serving stale data (a plugin published today must not read as "does not exist")
- No favorites, notes, groups, backup/restore, theme market, or comments (see
  `docs/PLUGIN-MARKET.md` §7)
- Motion is only guaranteed at the computed-style level (name, fill mode, delay, and that it can be
  switched off); the look of a specific frame and scroll compositing performance are not measured

## Development and verification

- Interface contract: `docs/API-CONTRACT.md`
- Design and specification mapping: `docs/PLUGIN-MARKET.md`
- Verification report: `verify/REPORT.md`, entry point `scripts/verify-market.ps1`
- Real-browser acceptance (headless Edge + CDP, writes screenshots): `pwsh -File verify/ui-check.ps1`

```sh
node --check plugin-market/lib/index.js
node --check plugin-market/lib/client.js
node verify/self-update.test.mjs
node verify/client-copy.test.mjs
```

## License

MIT. Catalog data remains the property of
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
