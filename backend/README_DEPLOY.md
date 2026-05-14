# Railway Deploy

This backend can be deployed to Railway without touching the Tauri app.

## What Railway needs

Set these environment variables in Railway:

- `PORT`
- `DATABASE_URL`
- `RIOT_API_KEY`
- `CORS_ORIGINS`
- `ENABLE_SCHEDULER`
- `STATS_UPDATE_INTERVAL_HOURS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`

## Important note about Prisma + SQLite

The current Prisma schema uses:

- `provider = "sqlite"`

So on Railway you should attach a persistent volume and point `DATABASE_URL` to a file on that volume, for example:

```env
DATABASE_URL="file:/data/dev.db"
```

Without a persistent volume, the SQLite database will be ephemeral and analytics data will be lost on redeploy/restart.

## Recommended Railway setup

1. Create a new Railway service from this repository.
2. Set the service root to `backend/` or deploy only the `backend` folder.
3. Add a persistent volume and mount it to:

```txt
/data
```

4. Set environment variables.

Example:

```env
PORT=8787
DATABASE_URL="file:/data/dev.db"
RIOT_API_KEY=RGAPI-...
CORS_ORIGINS=https://your-frontend-domain.com,http://127.0.0.1:1420,http://tauri.localhost
ENABLE_SCHEDULER=false
STATS_UPDATE_INTERVAL_HOURS=6
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=300
```

## Build and start behavior

The backend is configured so that:

- build step compiles TypeScript
- start step runs Prisma migrations and then starts the compiled server

Relevant scripts:

```json
"build": "tsc -p tsconfig.json",
"start": "node dist/server.js",
"db:deploy": "prisma migrate deploy",
"postinstall": "prisma generate"
```

`railway.json` uses:

- build command: `npm install && npm run build`
- start command: `npm run db:deploy && npm run start`

## Health check

Use:

```txt
/health
```

The endpoint returns:

- backend status
- database status

## Notes

- `PORT` is read from environment through backend config
- `RIOT_API_KEY` is never returned by API responses
- `.env` should not be committed
- Prisma client is generated automatically during install through `postinstall`
- if you change env vars in Railway, redeploy or restart the service

