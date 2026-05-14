# Liga

Lokalna desktopowa aplikacja Windows dla League of Legends zbudowana na Tauri, React,
TypeScript, TailwindCSS i SQLite.

Aplikacja nie ma backendu online. Integruje sie z League Client API przez lokalny
lockfile, pobiera dane statyczne z Riot Data Dragon i korzysta z lokalnego
`data/recommendations.json`.

## Funkcje

- wykrywanie League Client przez lockfile
- wykrywanie gameflow: ReadyCheck, ChampSelect, InProgress
- wykrywanie champion select, championa, roli i lokalnego summonerId
- rekomendacje run, summoner spells, win rate, pick rate i games count
- auto runes, auto summoners, auto ban, auto pick
- opcjonalne auto accept, domyslnie wylaczone
- Data Dragon cache z aktualizacja po zmianie patcha
- lokalne SQLite z migracjami, ustawieniami i logami
- import buildow z tekstu
- opcjonalny Riot API client przez `RIOT_API_KEY`
- ekran glowny, ustawienia, overlay i diagnostyka
- build produkcyjny Tauri z instalatorem NSIS

## Struktura

```txt
data/
  recommendations.json
  builds/
  defaults/

migrations/
  001_init.sql
  002_legacy_cache_tables.sql
  003_local_helper_tables.sql

src/
  app/App.tsx
  lib/database.ts
  styles/globals.css

src-node/
  league/                 lockfile, LCU API, champ select, runes, spells, pick/ban
  models/                 modele domenowe i ustawienia
  recommendations/        RecommendationProvider
  riot/                   Data Dragon i opcjonalny Riot API client
  services/               PatchManager, Gameflow, Auto*, PollingLoop, BuildImport

src-tauri/
  src/commands/
  src/db/
  icons/
  tauri.conf.json

tests/
  *.test.ts
```

## Instalacja

Wymagania:

- Windows 10/11
- Node.js 20+
- Rust stable z `cargo` w `PATH`
- Microsoft C++ Build Tools
- WebView2 Runtime

PowerShell moze blokowac `npm.ps1`, dlatego uzywaj:

```powershell
npm.cmd install
```

## Development

```powershell
npm.cmd run dev
```

Sam frontend:

```powershell
npm.cmd run dev:vite
```

## Testy i typy

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run typecheck:node
```

## Build

Frontend:

```powershell
npm.cmd run build:frontend
```

Pelny build Tauri:

```powershell
npm.cmd run build
```

Release z synchronizacja wersji i instalatorem NSIS:

```powershell
npm.cmd run release
```

Installer powstaje w:

```txt
src-tauri/target/release/bundle/nsis/
```

Opcjonalne podpisywanie Windows:

```powershell
$env:SIGN_CERT_THUMBPRINT="YOUR_CERT_SHA1_THUMBPRINT"
$env:SIGN_TIMESTAMP_URL="http://timestamp.digicert.com"
npm.cmd run sign:windows
```

## League Client API

Lockfile ma format:

```txt
process:pid:port:password:protocol
```

Moduly:

- `src-node/league/lockfile.ts`
- `src-node/league/lcuClient.ts`
- `src-node/league/champSelect.ts`
- `src-node/league/runes.ts`
- `src-node/league/summonerSpells.ts`
- `src-node/league/pickBan.ts`
- `src-node/league/autoAccept.ts`

Haslo z lockfile nie jest zapisywane w logach.

## Polling Loop

`src-node/services/PollingLoopService.ts` uruchamia cykl co 2-3 sekundy:

1. znajduje League Client przez lockfile,
2. pobiera gameflow,
3. obsluguje ReadyCheck przez AutoAccept,
4. w ChampSelect laduje rekomendacje po `championId` i roli,
5. uruchamia AutoRunes, AutoSummoners, AutoBan i AutoPick,
6. zabezpiecza sie przed wielokrotnym wykonaniem tej samej akcji.

## Data Dragon i Patch Manager

`PatchManager` pobiera aktualny patch z Data Dragon, cache'uje lokalnie championy,
summoner spells i runy, a po zmianie patcha odswieza dane. Kod obsluguje formaty
patchy Riot jako zwykle stringi, np. `26.10`.

## Import Buildow

`src-node/services/BuildImportService.ts` obsluguje format:

```txt
Champion: Ahri
Role: MID
Runes: Electrocute, Taste of Blood, Eyeball Collection, Ultimate Hunter, Manaflow Band, Scorch
Summoners: Flash, Ignite
Win rate: 52.3%
```

Importer mapuje nazwy championow, run i summoner spells na ID z Data Dragon.

## Riot API

Riot API jest opcjonalne. Podstawowe funkcje dzialaja bez klucza.

```powershell
$env:RIOT_API_KEY="RGAPI-..."
```

`src-node/riot/RiotApiClient.ts` zawiera proste rate limiting, match history,
pobieranie konta po Riot ID i pobieranie danych meczu.

## SQLite

Baza jest tworzona lokalnie jako `liga.sqlite` w katalogu danych aplikacji.
Migracje sa w `migrations/` i sa osadzone w `src-tauri/src/db/mod.rs`.

Glowne tabele:

- `app_settings`
- `champions`
- `runes`
- `summoner_spells`
- `recommendations`
- `patch_cache`
- `action_logs`
- `app_logs`

## Bezpieczenstwo

- nie loguj hasla z lockfile, Basic Auth ani pelnego lockfile
- ignorowanie self-signed certificate dotyczy tylko lokalnego League Client API
- nie uzywaj scraperow Cloudflare ani obchodzenia zabezpieczen
- nie ingeruj w gameplay ani pamiec procesu gry
- auto accept, auto pick i auto ban powinny byc swiadomie wlaczane w ustawieniach
- signing certificate trzymaj poza repozytorium

Szczegoly: [SECURITY.md](./SECURITY.md).
