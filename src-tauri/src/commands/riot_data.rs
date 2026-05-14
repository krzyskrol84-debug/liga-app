use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiotStaticData {
    pub patch: String,
    pub language: String,
    pub status: DataDragonStatus,
    pub champions: Vec<ChampionStaticData>,
    pub champion_name_to_id: HashMap<String, i64>,
    pub runes: HashMap<String, RuneStaticData>,
    pub perk_styles: Vec<PerkStyleStaticData>,
    pub summoner_spells: HashMap<String, SummonerSpellStaticData>,
    pub items: HashMap<String, ItemStaticData>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDragonStatus {
    pub state: String,
    pub patch: Option<String>,
    pub patch_source: String,
    pub cache_path: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionStaticData {
    pub id: String,
    pub key: i64,
    pub name: String,
    pub title: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneStaticData {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub style_id: Option<i64>,
    pub style_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerkStyleStaticData {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonerSpellStaticData {
    pub id: i64,
    pub data_dragon_id: String,
    pub name: String,
    pub description: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStaticData {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub plaintext: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiotApiStatus {
    pub state: String,
    pub message: String,
    pub status_code: Option<u16>,
}

#[tauri::command]
pub async fn get_riot_static_data(app: AppHandle) -> Result<RiotStaticData, String> {
    load_riot_static_data(app, false).await
}

#[tauri::command]
pub async fn refresh_riot_static_data(app: AppHandle) -> Result<RiotStaticData, String> {
    load_riot_static_data(app, true).await
}

#[tauri::command]
pub async fn clear_riot_data_cache(app: AppHandle) -> Result<RiotStaticData, String> {
    let cache_dir = cache_dir(&app)?;
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir)
            .map_err(|error| format!("Could not clear Riot/Data Dragon cache: {}", error))?;
    }
    load_riot_static_data(app, true).await
}

#[tauri::command]
pub async fn get_riot_api_status() -> Result<RiotApiStatus, String> {
    Ok(match read_riot_api_key() {
        Some(_) => RiotApiStatus {
            state: "available".to_string(),
            message: "RIOT_API_KEY is configured in backend environment.".to_string(),
            status_code: None,
        },
        None => RiotApiStatus {
            state: "missing".to_string(),
            message:
                "RIOT_API_KEY is not configured. Data Dragon and local LCU features still work."
                    .to_string(),
            status_code: None,
        },
    })
}

#[tauri::command]
pub async fn test_riot_api() -> Result<RiotApiStatus, String> {
    let Some(api_key) = read_riot_api_key() else {
        return Ok(RiotApiStatus {
            state: "missing".to_string(),
            message: "RIOT_API_KEY is missing. Optional Riot API features are disabled."
                .to_string(),
            status_code: None,
        });
    };

    wait_for_riot_rate_limit().await;

    let client = reqwest::Client::new();
    let response = client
        .get("https://euw1.api.riotgames.com/lol/status/v4/platform-data")
        .header("X-Riot-Token", api_key)
        .send()
        .await
        .map_err(|error| format!("Riot API test request failed: {}", error))?;

    let status = response.status();

    if status.is_success() {
        return Ok(RiotApiStatus {
            state: "available".to_string(),
            message: "Riot API key is valid and the test endpoint responded.".to_string(),
            status_code: Some(status.as_u16()),
        });
    }

    let message = match status.as_u16() {
        403 => {
            "Riot API returned 403. The key is invalid, expired, or not allowed for this endpoint."
        }
        404 => "Riot API returned 404. The tested endpoint was not found.",
        429 => "Riot API returned 429. Rate limit reached; try again later.",
        500..=599 => "Riot API returned a server error. Try again later.",
        _ => "Riot API returned an error.",
    };

    Ok(RiotApiStatus {
        state: "error".to_string(),
        message: message.to_string(),
        status_code: Some(status.as_u16()),
    })
}

async fn load_riot_static_data(
    app: AppHandle,
    force_refresh: bool,
) -> Result<RiotStaticData, String> {
    let cache_dir = cache_dir(&app)?;
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Could not create Data Dragon cache: {}", error))?;

    let client = reqwest::Client::new();
    let latest_patch = fetch_latest_patch(&client).await?;
    let snapshot_path = cache_dir.join("static-data.json");

    if !force_refresh {
        if let Ok(raw) = fs::read_to_string(&snapshot_path) {
            if let Ok(mut cached) = serde_json::from_str::<RiotStaticData>(&raw) {
                if cached.patch == latest_patch {
                    cached.status = DataDragonStatus {
                        state: "cached".to_string(),
                        patch: Some(cached.patch.clone()),
                        patch_source:
                            "https://ddragon.leagueoflegends.com/api/versions.json[0]"
                                .to_string(),
                        cache_path: Some(snapshot_path.display().to_string()),
                        message: Some("Loaded Data Dragon data from cache.".to_string()),
                    };
                    return Ok(cached);
                }
            }
        }
    }

    let data = fetch_static_data(&client, &latest_patch, "en_US", snapshot_path.clone()).await?;
    let serialized = serde_json::to_string_pretty(&data)
        .map_err(|error| format!("Could not serialize Data Dragon cache: {}", error))?;
    fs::write(&snapshot_path, format!("{}\n", serialized))
        .map_err(|error| format!("Could not write Data Dragon cache: {}", error))?;

    Ok(data)
}

async fn fetch_latest_patch(client: &reqwest::Client) -> Result<String, String> {
    let versions = client
        .get("https://ddragon.leagueoflegends.com/api/versions.json")
        .send()
        .await
        .map_err(|error| format!("Could not fetch Data Dragon versions: {}", error))?
        .json::<Vec<String>>()
        .await
        .map_err(|error| format!("Could not parse Data Dragon versions: {}", error))?;

    versions
        .into_iter()
        .next()
        .ok_or_else(|| "Data Dragon versions response was empty.".to_string())
}

async fn fetch_static_data(
    client: &reqwest::Client,
    patch: &str,
    language: &str,
    snapshot_path: PathBuf,
) -> Result<RiotStaticData, String> {
    let champion_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/champion.json",
        patch, language
    );
    let summoner_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/summoner.json",
        patch, language
    );
    let runes_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/runesReforged.json",
        patch, language
    );
    let items_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/{}/item.json",
        patch, language
    );

    let (champions_raw, summoners_raw, runes_raw, items_raw) = tokio::try_join!(
        fetch_json(client, &champion_url),
        fetch_json(client, &summoner_url),
        fetch_json(client, &runes_url),
        fetch_json(client, &items_url)
    )?;

    let champions_value: serde_json::Value = champions_raw;
    let summoners_value: serde_json::Value = summoners_raw;
    let runes_value: serde_json::Value = runes_raw;
    let items_value: serde_json::Value = items_raw;

    let mut champions = parse_champions(&champions_value, patch)?;
    champions.sort_by(|a, b| a.name.cmp(&b.name));

    let champion_name_to_id = champions
        .iter()
        .map(|champion| (normalize_name(&champion.name), champion.key))
        .collect::<HashMap<_, _>>();

    let mut runes = parse_runes(&runes_value);
    add_stat_shards(&mut runes);

    Ok(RiotStaticData {
        patch: patch.to_string(),
        language: language.to_string(),
        status: DataDragonStatus {
            state: "fresh".to_string(),
            patch: Some(patch.to_string()),
            patch_source: "https://ddragon.leagueoflegends.com/api/versions.json[0]"
                .to_string(),
            cache_path: Some(snapshot_path.display().to_string()),
            message: Some("Downloaded fresh Data Dragon data.".to_string()),
        },
        champions,
        champion_name_to_id,
        runes,
        perk_styles: parse_perk_styles(&runes_value),
        summoner_spells: parse_summoner_spells(&summoners_value, patch)?,
        items: parse_items(&items_value, patch)?,
        warnings: Vec::new(),
    })
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
    client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not download Data Dragon file: {}", error))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Could not parse Data Dragon file: {}", error))
}

fn parse_champions(
    value: &serde_json::Value,
    patch: &str,
) -> Result<Vec<ChampionStaticData>, String> {
    let data = value
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| {
            "Data Dragon champion response did not contain a data object.".to_string()
        })?;

    let mut champions = Vec::new();

    for champion in data.values() {
        let id = string_field(champion, "id")?;
        let key = string_field(champion, "key")?
            .parse::<i64>()
            .map_err(|_| format!("Champion {} has invalid key.", id))?;
        let name = string_field(champion, "name")?;
        let title = string_field(champion, "title").unwrap_or_default();
        let image = champion
            .get("image")
            .and_then(|value| value.get("full"))
            .and_then(|value| value.as_str())
            .unwrap_or("");

        champions.push(ChampionStaticData {
            id,
            key,
            name,
            title,
            icon_url: format!(
                "https://ddragon.leagueoflegends.com/cdn/{}/img/champion/{}",
                patch, image
            ),
        });
    }

    Ok(champions)
}

fn parse_summoner_spells(
    value: &serde_json::Value,
    patch: &str,
) -> Result<HashMap<String, SummonerSpellStaticData>, String> {
    let data = value
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| {
            "Data Dragon summoner response did not contain a data object.".to_string()
        })?;

    let mut spells = HashMap::new();

    for spell in data.values() {
        let id = string_field(spell, "key")?
            .parse::<i64>()
            .map_err(|_| "Summoner spell has invalid key.".to_string())?;
        let data_dragon_id = string_field(spell, "id")?;
        let name = string_field(spell, "name")?;
        let description = string_field(spell, "description").unwrap_or_default();
        let image = spell
            .get("image")
            .and_then(|value| value.get("full"))
            .and_then(|value| value.as_str())
            .unwrap_or("");

        spells.insert(
            id.to_string(),
            SummonerSpellStaticData {
                id,
                data_dragon_id,
                name,
                description,
                icon_url: format!(
                    "https://ddragon.leagueoflegends.com/cdn/{}/img/spell/{}",
                    patch, image
                ),
            },
        );
    }

    Ok(spells)
}

fn parse_items(
    value: &serde_json::Value,
    patch: &str,
) -> Result<HashMap<String, ItemStaticData>, String> {
    let data = value
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Data Dragon item response did not contain a data object.".to_string())?;

    let mut items = HashMap::new();

    for (item_id, item) in data {
        let parsed_id = item_id
            .parse::<i64>()
            .map_err(|_| format!("Item {} has invalid id.", item_id))?;
        let name = string_field(item, "name")?;
        let description = string_field(item, "description").unwrap_or_default();
        let plaintext = string_field(item, "plaintext").unwrap_or_default();

        items.insert(
            item_id.to_string(),
            ItemStaticData {
                id: parsed_id,
                name,
                description,
                plaintext,
                icon_url: format!(
                    "https://ddragon.leagueoflegends.com/cdn/{}/img/item/{}.png",
                    patch, item_id
                ),
            },
        );
    }

    Ok(items)
}

fn parse_perk_styles(value: &serde_json::Value) -> Vec<PerkStyleStaticData> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|style| {
            Some(PerkStyleStaticData {
                id: style.get("id")?.as_i64()?,
                key: style.get("key")?.as_str()?.to_string(),
                name: style.get("name")?.as_str()?.to_string(),
                icon_url: format!(
                    "https://ddragon.leagueoflegends.com/cdn/img/{}",
                    style.get("icon")?.as_str()?
                ),
            })
        })
        .collect()
}

fn parse_runes(value: &serde_json::Value) -> HashMap<String, RuneStaticData> {
    let mut runes = HashMap::new();

    for style in value.as_array().into_iter().flatten() {
        let style_id = style.get("id").and_then(|value| value.as_i64());
        let style_name = style
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let Some(slots) = style.get("slots").and_then(|value| value.as_array()) else {
            continue;
        };

        for slot in slots {
            let Some(slot_runes) = slot.get("runes").and_then(|value| value.as_array()) else {
                continue;
            };

            for rune in slot_runes {
                let Some(id) = rune.get("id").and_then(|value| value.as_i64()) else {
                    continue;
                };
                let icon = rune.get("icon").and_then(|value| value.as_str());
                runes.insert(
                    id.to_string(),
                    RuneStaticData {
                        id,
                        key: rune
                            .get("key")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: rune
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("Unknown rune")
                            .to_string(),
                        icon_url: icon.map(|icon| {
                            format!("https://ddragon.leagueoflegends.com/cdn/img/{}", icon)
                        }),
                        style_id,
                        style_name: style_name.clone(),
                    },
                );
            }
        }
    }

    runes
}

fn add_stat_shards(runes: &mut HashMap<String, RuneStaticData>) {
    for (id, name) in [
        (5001, "Health"),
        (5002, "Armor"),
        (5003, "Magic Resist"),
        (5005, "Attack Speed"),
        (5007, "Ability Haste"),
        (5008, "Adaptive Force"),
        (5011, "Health Scaling"),
    ] {
        runes
            .entry(id.to_string())
            .or_insert_with(|| RuneStaticData {
                id,
                key: format!("StatMod{}", id),
                name: name.to_string(),
                icon_url: None,
                style_id: None,
                style_name: Some("Stat shards".to_string()),
            });
    }
}

fn string_field(value: &serde_json::Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing Data Dragon field: {}", field))
}

fn normalize_name(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data dir: {}", error))?
        .join("riot-data-dragon"))
}

fn read_riot_api_key() -> Option<String> {
    std::env::var("RIOT_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| read_riot_api_key_from_env_file())
}

fn read_riot_api_key_from_env_file() -> Option<String> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(".env"));
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.join(".env"));
        }
    }

    for path in candidates {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || !trimmed.starts_with("RIOT_API_KEY=") {
                continue;
            }

            let value = trimmed
                .trim_start_matches("RIOT_API_KEY=")
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();

            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

async fn wait_for_riot_rate_limit() {
    static LAST_REQUEST_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    let lock = LAST_REQUEST_AT.get_or_init(|| Mutex::new(None));
    let wait_for = {
        let mut last_request_at = lock.lock().expect("Riot API rate limiter mutex poisoned");
        let now = Instant::now();
        let wait_for = last_request_at
            .and_then(|last| {
                Duration::from_millis(1_250).checked_sub(now.saturating_duration_since(last))
            })
            .unwrap_or_default();
        *last_request_at = Some(now + wait_for);
        wait_for
    };

    if !wait_for.is_zero() {
        tokio::time::sleep(wait_for).await;
    }
}
