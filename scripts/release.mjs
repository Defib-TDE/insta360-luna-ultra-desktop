/**
 * Public releases are intentionally blocked for the development fork.
 *
 * The inherited repository has no LICENSE file and the rights for bundled
 * assets have not been established. Keep this command present so an old habit
 * fails safely instead of creating tags or publishing artifacts.
 */

console.error("Release blocked: this development fork is not cleared for distribution.");
console.error("See docs/DISTRIBUTION.md before restoring release automation.");
process.exitCode = 1;
