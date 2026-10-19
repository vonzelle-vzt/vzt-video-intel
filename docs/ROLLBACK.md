# Rollback plan

vzt-video-intel is an npm package (CLI + MCP server) listed in the MCP
registry via `server.json`. It has no hosted service, no mobile app, and no
database migrations, so rollback means pulling or superseding a bad release.

## Roll back a published npm release

1. Point users at the last good version: `npm dist-tag add vzt-video-intel@<good-version> latest`.
2. If the bad version is dangerous (data loss, security), deprecate it:
   `npm deprecate vzt-video-intel@<bad-version> "Broken — use <good-version>"`.
   Unpublishing is only possible within 72 hours and should be a last resort.
3. Ship the fix as a new patch version (never reuse a version number).
4. Users pinned to a bad version recover with `npx vzt-video-intel@<good-version>`.

## Roll back the MCP registry listing

Re-publish `server.json` pointing at the last good package version
(`mcp-publisher publish`), then follow up with the fixed release.

## Roll back the source

`git revert <merge-commit>` on `main` through a pull request (CI must pass),
then cut a patch release as above. Do not force-push `main`.

## If a hosted deploy is ever added

- Vercel: promote the previous deployment (`vercel rollback` or Dashboard →
  Deployments → previous → Promote to Production).
- Database migrations: none exist today. If added, ship a down migration with
  every up migration and revert with it before redeploying the old build.

## Local state

Cache and config live in `~/.vzt-video-intel` (override with
`VZT_VIDEO_INTEL_HOME`). Deleting the `cache` subdirectory is always safe.
