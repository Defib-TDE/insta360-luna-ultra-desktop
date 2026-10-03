# Dependency audit baseline

Recorded 2026-10-03 during Phase 0. Re-run these checks whenever either lockfile
changes.

## JavaScript and documentation workspace

Commands:

```bash
bun audit --production
bun run audit:critical
```

Compatible direct upgrades and `bun audit fix` reduced the report from 60
advisories (1 critical, 31 high, 23 moderate, 5 low) to 5 advisories (2 high,
3 moderate). The critical gate passes.

The remaining entries are transitive dependencies of the documentation/build
workspace, not the static Tauri application's camera runtime:

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

`h2` was updated to 0.4.16 and `rustls` to 0.23.45 to clear two actionable
advisories. The audit reports zero vulnerabilities and exits successfully.

RustSec still reports eight allowed warnings inherited through Tauri's Linux
GTK/WebKit and crypto dependency graph: six unmaintained crates, one `glib`
unsoundness warning, and one yanked `chacha20` release. They cannot be removed
locally without upstream dependency changes and must remain visible in CI.
