# liga-backend

Node.js + TypeScript backend for the local Liga desktop app.

## Stack

- Node.js
- TypeScript
- Express
- Prisma
- SQLite
- Riot API
- Data Dragon

## Setup

1. Install dependencies:

```powershell
cd backend
npm.cmd install
```

2. Create `.env` from the example:

```powershell
Copy-Item .env.example .env
```

3. Fill in `RIOT_API_KEY` in `backend/.env`.

4. Generate Prisma client and run migrations:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate -- --name init
```

## Development

```powershell
npm.cmd run dev
```

Backend starts by default on `http://127.0.0.1:8787`.

## Production build

```powershell
npm.cmd run build
npm.cmd run start
```

## Environment

- `PORT` - backend port
- `RIOT_API_KEY` - Riot API key
- `DATABASE_URL` - Prisma SQLite database URL
- `CORS_ORIGINS` - comma-separated allowed origins
- `ENABLE_SCHEDULER` - `true` / `false`
- `STATS_UPDATE_INTERVAL_HOURS` - scheduler interval
- `RATE_LIMIT_WINDOW_MS` - global request rate-limit window
- `RATE_LIMIT_MAX_REQUESTS` - max requests per IP+path within the window

## Health

`GET /health`

Returns:
- service status
- database status

## Security notes

- Riot API key is never returned by API responses
- request logs do not include secrets or request bodies
- CORS uses an allowlist from env
- Prisma disconnects on graceful shutdown
- rate limiting is enabled for the whole API surface

