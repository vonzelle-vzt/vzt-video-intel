# Contributing

Thanks for your interest. VZT Video-Intel is open source under MIT — every contribution is welcome.

## Setup

```bash
git clone https://github.com/vonzelle-vzt/vzt-video-intel.git
cd vzt-video-intel
npm install
npm run build
npm test
```

Most local development can be done without booting the docker stack — the orchestrator + CLI typecheck, build, and unit-test against stubbed HTTP responses. You only need the docker stack to run end-to-end.

## Project conventions

- **TypeScript strict.** No `any` without a comment.
- **ESM only.** `type: module`, `.js` import extensions.
- **No comments unless they justify a non-obvious choice.** Names should carry the meaning.
- **Each backend is a pure HTTP wrapper.** No model logic in `src/backends/*` beyond input/output shaping.
- **Schema changes need a `_version` bump** in `src/pipeline/orchestrator.ts` and a [SCHEMA](docs/SCHEMA.md) update.

## Adding a new backend

Want to add a new model (e.g. DEVA, Whisper.cpp, BLIP-2)?

1. Create `src/backends/<name>.ts` with a typed `POST /run` client.
2. Add a `docker/<name>/{Dockerfile,server.py}` exposing `GET /health` + `POST /run`.
3. Wire it into `docker/docker-compose.yml`.
4. Add an env var in `docker/.env.example` and `src/lib/env.ts`.
5. Update [BACKENDS.md](docs/BACKENDS.md) with the HTTP contract.
6. Add a smoke test in `test/smoke.test.ts`.

If your backend replaces an existing one, just point its env var at the new URL — the orchestrator doesn't care.

## PR checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] New docs in `docs/` if you changed the schema or added a backend
- [ ] A line in [CHANGELOG](CHANGELOG.md) under an Unreleased section
- [ ] One commit per logical change (squash merges happen)
- [ ] Commit message follows conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`)

## Reporting bugs

Open an issue with:
- Output of `vzt-video-intel doctor`
- Node version (`node --version`)
- Docker version (`docker --version`)
- A minimal reproduction (a short video + the exact command)

## License

By contributing, you agree your changes are released under MIT.
