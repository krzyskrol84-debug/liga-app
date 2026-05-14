# Security Best Practices

## Local-Only League Client API

The app communicates only with the local League Client API over `https://127.0.0.1:<port>`.
The LCU password is read from the League lockfile at runtime and must never be persisted.

## Secrets

- Do not commit Riot API keys, certificates, signing keys, or `.env` files.
- Do not log the LCU password, Basic Auth header, or lockfile contents.
- Keep signing certificate material outside the repository.

## HTTPS and Certificates

League Client API uses a local self-signed certificate. The app disables certificate validation only for the local LCU client.
Do not reuse that HTTP client for public internet requests.

## Data Sources

Allowed sources:

- League Client API
- Riot Data Dragon
- local JSON files
- local SQLite database

Avoid paid APIs and Cloudflare-protected scrapers.

## Logging

Logs should contain operational metadata only:

- champion detect
- role detect
- API error category
- rune/summoner apply success
- connection errors

Logs should not contain tokens, passwords, lockfile raw content, or personally sensitive account data.

## Auto Apply

Keep auto-apply settings explicit and user-controlled:

- `autoSetRunes`
- `autoSetSummoners`
- `preferredRole`

Manual confirmation should remain available as the safer default.

## Signing

Windows signing is optional. Use `scripts/sign-windows.ps1` with a certificate thumbprint from the local certificate store.
Do not store PFX files or certificate passwords in the repository.
