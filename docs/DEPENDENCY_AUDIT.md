# Dependency audit baseline

Recorded 2026-10-03 during Phase 0; JavaScript findings refreshed 2026-10-06.
Re-run these checks whenever either lockfile changes.

## JavaScript and documentation workspace

Commands:

```bash
bun audit --production
bun run audit:critical
```

Compatible direct upgrades and `bun audit fix` reduced the report from 60
advisories (1 critical, 31 high, 23 moderate, 5 low) to 5 advisories (2 high,
3 moderate) at the initial audit. Newly published advisories changed that
baseline. The current report has 9 advisories (5 high, 4 moderate), and the
critical gate passes after the Git tooling repair below.

On 2026-10-05 CI detected two critical Git tooling advisories,
[GHSA-x6jw-m9v5-85vh](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) and
[GHSA-v5rq-49vh-5v5c](https://github.com/advisories/GHSA-v5rq-49vh-5v5c).
The root override pins `simple-git` 4.0.2, which brings
`@simple-git/argv-parser` 2.0.1. Stable Nuxt Devtools 3.4.2 still imports the
removed default export, so the checked-in Bun patch changes that single import
to `simpleGit`'s named export. No security guards or audit thresholds are
disabled. Remove the override and patch when the stable Nuxt tooling supplies
the patched Git dependency and compatible import itself.

Normal frozen installation, Nuxt preparation, application unit/Nuxt tests,
typecheck and frontend generation pass with the patch. Read-only Git status
and classification of unsafe editor/trailer arguments were checked; unsafe
Git operations were not executed. The docs build also exposed a missing
Studio demo redirect, which is now included alongside the existing demo routes.
Documentation generation passes with zero link errors; existing trailing-slash
warnings remain visible.

The remaining entries are transitive application UI, documentation and build
dependencies; none is the native camera protocol implementation:

| Package                | Severity              | Reason still present                                                          |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `braces` 3.0.3         | high                  | No published fixed version is available to the current dependency chain.      |
| `node-forge` 1.4.0     | high                  | No published fixed version is available to the current Nuxt CLI chain.        |
| `nuxt-og-image` 5.1.13 | 3 moderate advisories | The fix requires `nuxt-og-image` 6.2.5+, outside `@nuxtjs/seo` 3.4.0's range. |
| `@vue/server-renderer` 3.5.40 | high | New advisory requires 3.5.42+; patch upgrade remains pending. |
| `postcss-selector-parser` 7.1.4 | moderate | New advisory requires 7.1.6+; patch upgrade remains pending. |
| `prosemirror-view` 1.42.1 | high | Older nested copy remains alongside 1.42.6; deduplication/patch upgrade is pending. |
| `source-map-js` 1.2.1 | high | New advisory requires 1.2.2+; patch upgrade remains pending. |

Do not hide these with audit ignores. Upgrade the docs SEO stack separately,
then remove this exception record when the full audit passes.

## Rust/Tauri

Command:

```bash
cargo audit --file src-tauri/Cargo.lock
```

`h2` was updated to 0.4.16 and `rustls` to 0.23.45 to clear two actionable
advisories. The audit reports zero vulnerabilities and exits successfully.

RustSec still reports eight allowed warnings inherited through Tauri's Linux
GTK/WebKit and crypto dependency graph: six unmaintained crates, one `glib`
unsoundness warning, and one yanked `chacha20` release. They cannot be removed
locally without upstream dependency changes and must remain visible in CI.
