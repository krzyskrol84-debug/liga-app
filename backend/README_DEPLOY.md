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

## Prisma + PostgreSQL

The backend uses Railway PostgreSQL through:

- `provider = "postgresql"`
- `DATABASE_URL`

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Use Railway's Postgres plugin/reference variable for `DATABASE_URL`. If `DATABASE_URL` is missing, `/health` reports the database as unavailable instead of pretending the backend is healthy.

## Recommended Railway setup

1. Create a new Railway service from this repository.
2. Set the service root to `backend/` or deploy only the `backend` folder.
3. Add a Railway PostgreSQL database and expose its `DATABASE_URL` to the backend service.
4. Set environment variables.

Example:

```env
PORT=8787
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
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
- start step generates Prisma client, deploys migrations, and then starts the compiled server

Relevant scripts:

```json
"build": "tsc -p tsconfig.json",
"start": "node dist/server.js",
"start:railway": "prisma generate && prisma migrate deploy && npm run start",
"db:migrate": "prisma migrate deploy",
"db:deploy": "prisma migrate deploy",
"postinstall": "prisma generate"
```

`railway.json` uses:

- build command: `npm install && npm run build`
- start command: `npm run start:railway`

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
