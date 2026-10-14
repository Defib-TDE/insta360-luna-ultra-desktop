# Dependency audit baseline

Recorded 2026-10-03 during Phase 0; JavaScript findings refreshed 2026-10-14.
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
baseline. On October 14 the fresh production report had 10 advisories
(1 critical, 5 high, 4 moderate), including new `shell-quote` command injection
[GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
Compatible updates repair `shell-quote` (1.11.0), `postcss-selector-parser`
(7.1.6), nested `prosemirror-view` (1.42.3), `source-map-js` (1.2.2), and the
Vue 3.5.44 family. Five production advisories remain (2 high, 3 moderate).
The existing critical gate and full visible audit are retained.

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

Do not hide these with audit ignores. Upgrade the docs SEO stack separately,
then remove this exception record when the full audit passes.

## Rust/Tauri

Command:

```bash
cargo audit --file src-tauri/Cargo.lock
```

`h2` 0.4.16 and `rustls` 0.23.45 cleared the initial advisories. The
October 14 audit found five advisories in locked `quinn-proto` 0.11.16:
RUSTSEC-2026-0338 through RUSTSEC-2026-0342. It is updated to the compatible
patched 0.11.18 release; no audit ignores or severity thresholds are changed.
The full native test suite passes after the lockfile update. Fresh local
`cargo audit` reports zero vulnerabilities, exits successfully and retains the
eight warnings below. Hosted Windows verification is recorded in
`CODEX_HANDOFF.md`.

RustSec still reports eight allowed warnings inherited through Tauri's Linux
GTK/WebKit and crypto dependency graph: six unmaintained crates, one `glib`
unsoundness warning, and one yanked `chacha20` release. They cannot be removed
locally without upstream dependency changes and must remain visible in CI.
