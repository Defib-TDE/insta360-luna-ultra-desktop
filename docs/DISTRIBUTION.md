# Distribution status

This fork is for local development and hardware testing. Public binary releases
are intentionally disabled.

## Why releases are blocked

The upstream repository does not contain a `LICENSE` file, and the Rust package
did not declare a license. No permission has been established for redistributing
modified source or binaries. Rights for bundled third-party assets—including the
watermark artwork and camera scan—also need to be confirmed independently.

This is a project safeguard, not a legal conclusion. Until the copyright holder
and asset owners provide suitable terms:

- do not create a public installer or GitHub Release;
- do not represent the fork as an official Insta360 product;
- keep upstream and protocol attribution intact;
- use locally built artifacts only for development and hardware testing.

## Safeguards in this branch

- `.github/workflows/release.yml` is removed, so tags cannot publish binaries.
- `bun run release` exits without changing versions, commits, tags, or remotes.
- the Rust crate has `publish = false`.
- the Tauri updater remains absent and updater artifacts remain disabled.

## Requirements before restoring releases

1. Obtain or confirm a repository license covering modification and
   redistribution.
2. Confirm redistribution rights for every bundled image, watermark, font,
   model, protocol-derived file, and other asset.
3. Document trademark and unofficial-project wording.
4. Rebuild the release workflow around the development app identity and test it
   using draft, prerelease artifacts only.
5. Add platform signing, provenance, checksums, and an explicit approval gate.
6. Review the result before reintroducing any tag-triggered publication.
