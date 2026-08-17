# Deploying to Fly — read before running `fly deploy`

**Only one thing in this repository is hosted on Fly: the realtime service in `server/`.**
The Next.js app is hosted on **Vercel** (`https://www.recopyfa.st`). See
[`../architecture.md`](../architecture.md) § Two deploy targets.

## Always deploy from `server/`

```bash
cd server
fly deploy
```

`server/fly.toml` is the only Fly config in this repository, and that is deliberate. It lives in
`server/` because `fly deploy` uses the directory of `fly.toml` as the Docker build context, and
`server/Dockerfile` is written for a `server/`-rooted context.

## Why there is no `fly.toml` at the repo root

There was one, briefly. `fly launch` from the Fly UI scans a repository, detects Next.js, and opens
a pull request adding a root `fly.toml`, `Dockerfile`, `docker-entrypoint.js` and `.dockerignore`.
That PR was merged as #15 on 2026-08-17. **Those files were removed the same day**, because they
were actively dangerous rather than merely redundant:

- The root `fly.toml` declared **`app = 'recopyfast-ws'`** — the *same Fly app as the realtime
  service* — while its `Dockerfile` builds the **Next.js site** (`npx next build`).
- So `fly deploy` from the repo root, which is the obvious thing to type, would have **replaced the
  realtime service with a second copy of the website** and taken co-editing down.
- It also set `internal_port = 8080`, `auto_stop_machines = 'stop'` and `min_machines_running = 0`.
  That config is what the live app was created with, and it is why the service could not serve:
  `server/index.js:1177` binds `WS_PORT || 4001` and ignores `PORT`, so nothing listened on 8080.

If you ever want the Next.js app on Fly as well, it needs its **own app name** and its own config
directory — never the realtime service's. Re-running `fly launch` from the repo root will recreate
these files; decline the PR, or move them under a directory of their own.
