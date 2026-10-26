# Rollback

vzt-video-intel is an npm package / MCP server / CLI. It is not deployed to Vercel, has no mobile build, and has no database migrations (state is local JSON under `~/.vzt-video-intel`).

## Bad npm release

1. Stop new installs of the bad version: `npm deprecate vzt-video-intel@<bad> "broken, use <good>"`.
2. Point `latest` back at the last good version: `npm dist-tag add vzt-video-intel@<good> latest`.
3. Ship the fix as a new patch version. Unpublishing is only possible within 72 hours and should be avoided.
4. If the MCP registry entry (`server.json`) was bumped, revert it to the previous version and republish it.

## Bad commit on main

`git revert <sha>` through a PR; do not force-push main. Tags/GitHub releases for the bad version should be edited to mark them as superseded.

## Users

Pin the last good version: `npx vzt-video-intel@<good>` or `npm i -g vzt-video-intel@<good>`.

## Database migrations

None in this repo. Cached analysis output lives in the cache dir (`VZT_CACHE_DIR`) and is safe to delete to force regeneration.
