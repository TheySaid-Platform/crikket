<h1 align="center">Crikket</h1>

<p align="center">
  <strong>Open-source bug reporting with the context engineers actually need.</strong>
</p>

<p align="center">
  Crikket helps teams capture bugs in one click, attach replay context automatically,
  and share reports with a single link.
</p>

<p align="center">
  <a href="https://crikket.io">Website</a> ·
  <a href="https://crikket.io/docs">Documentation</a> ·
  <a href="https://app.crikket.io">Cloud App</a> ·
  <a href="https://app.crikket.io/s/gVQoTvqv0vRo">Live Demo</a>
</p>

<p align="center">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/redpangilinan/crikket?style=for-the-badge" />
  <img alt="GitHub License" src="https://img.shields.io/github/license/redpangilinan/crikket?style=for-the-badge" />
  <img alt="Bun" src="https://img.shields.io/badge/Bun-1.3%2B-black?style=for-the-badge&logo=bun" />
</p>

![Crikket preview](./apps/docs/public/og.png)

## Why Crikket

Crikket is a modern, open-source alternative to tools like jam.dev and marker.io.
It is built for teams that want faster bug reproduction without giving up control
over their stack.

- Capture bugs with screenshot or screen recording directly in the browser
- Include reproduction steps, console logs, and network requests automatically
- Share reports instantly with public or private links
- Self-host for free or use the hosted app
- Capture any tab with the Crikket Chrome extension

## What Makes It Useful

Every report is designed to reduce the usual debugging back-and-forth.

| Area | What Crikket includes |
| --- | --- |
| Capture | One-click screenshot and video bug reports |
| Reproduction | Recorded steps to help replay what happened |
| Technical context | Console logs and network requests attached to the report |
| Sharing | Public or private share links per report |
| Collaboration | Team workspaces, invites, and report management |
| Deployment | Quick and easy self-hosting |

## Quick Start

### Self-hosted

The fastest path from a fresh clone is the interactive setup wizard:

```bash
git clone https://github.com/redpangilinan/crikket
cd crikket
./scripts/setup.sh
```

The wizard handles env files, secret generation, domain prompts, Caddy setup,
and Docker startup for the supported self-hosted flow.

Useful links:

- [Self-hosting quick start](https://crikket.io/docs/self-hosting/quick-start)
- [Production deployment guide](https://crikket.io/docs/self-hosting/production)
- [Self-hosting troubleshooting](https://crikket.io/docs/self-hosting/troubleshooting)

### Local development

For contributor setup and app-specific environment details:

```bash
bun install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/server/.env.example apps/server/.env
cp apps/docs/.env.example apps/docs/.env
cp apps/extension/.env.example apps/extension/.env
```

Then configure your env values, apply the database schema, and start the repo:

```bash
bun run db:push
bun run dev
```

Default local ports:

- `web`: `http://localhost:3001`
- `server`: `http://localhost:3000`
- `docs`: `http://localhost:4000`

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## Capture Bugs From Any Tab

Install the Crikket Chrome extension to record any open tab — with console
logs, network requests, and errors attached automatically. The web dashboard
surfaces an install link, or grab it directly from the Chrome Web Store.

- [Capture quick start docs](https://crikket.io/docs/usage/quick-start)

## Monorepo Overview

Crikket is a Bun + Turborepo monorepo.

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app for the product dashboard |
| `apps/server` | Hono API for auth, capture, and backend workflows |
| `apps/docs` | Marketing site and docs |
| `apps/extension` | Browser extension app |
| `packages/*` | Shared internal packages |

## Contributing

Issues, pull requests, and feedback are welcome.

- [Contributing guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## License

Licensed under the [AGPL-3.0](./LICENSE).
