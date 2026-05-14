use tauri::State;

pub mod database;
pub use database::*;
pub mod riot_data;
pub use riot_data::*;

use crate::models::app_status::AppStatus;
use crate::services::app_state::AppState;

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> AppStatus {
    state.status()
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeagueClientStatus {
    pub connected: bool,
    pub gameflow_phase: Option<String>,
    pub lockfile_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoActionResponse {
    pub success: bool,
    pub action: String,
    pub gameflow_phase: String,
    pub action_id: Option<i64>,
    pub champion_id: Option<i64>,
    pub local_player_cell_id: Option<i64>,
    pub status_code: Option<u16>,
    pub body: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBanRequest {
    pub preferred_ban_champion_id: Option<i64>,
    pub backup_ban_champion_id: Option<i64>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPickRequest {
    pub preferred_pick_champion_id: Option<i64>,
    pub backup_pick_champion_ids: Vec<i64>,
    pub confirm_pick: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRecommendationRequest {
    pub champion: String,
    pub role: String,
    pub primary_style: String,
    pub sub_style: String,
    pub selected_perk_ids: Vec<i64>,
    pub summoner_spell_ids: [i64; 2],
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRecommendationResponse {
    pub success: bool,
    pub champion: String,
    pub role: String,
    pub gameflow_phase: String,
    pub rune_page_id: i64,
    pub rune_page_name: String,
    pub spell1_id: i64,
    pub spell2_id: i64,
    pub summoner_id: i64,
}

#[derive(Debug, Clone)]
struct LcuCredentials {
    lockfile_path: String,
    protocol: String,
    port: u16,
    password: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LcuRunePage {
    id: i64,
    name: String,
    primary_style_id: i64,
    sub_style_id: i64,
    selected_perk_ids: Vec<i64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateRunePageRequest {
    name: String,
    primary_style_id: i64,
    sub_style_id: i64,
    selected_perk_ids: Vec<i64>,
    current: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MySelectionPatch {
    spell1_id: i64,
    spell2_id: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChampSelectSession {
    local_player_cell_id: i64,
    my_team: Vec<ChampSelectPlayer>,
    their_team: Vec<ChampSelectPlayer>,
    actions: Vec<Vec<ChampSelectAction>>,
    bans: Option<ChampSelectBans>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChampSelectPlayer {
    cell_id: i64,
    champion_id: i64,
    spell1_id: i64,
    spell2_id: i64,
    summoner_id: i64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChampSelectAction {
    actor_cell_id: i64,
    champion_id: i64,
    completed: bool,
    id: i64,
    is_in_progress: bool,
    #[serde(rename = "type")]
    action_type: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChampSelectBans {
    my_team_bans: Vec<i64>,
    their_team_bans: Vec<i64>,
}

#[tauri::command]
pub async fn check_league_client_status() -> LeagueClientStatus {
    match read_lcu_credentials() {
        Ok(credentials) => {
            let client = match build_lcu_client() {
                Ok(client) => client,
                Err(error) => {
                    return LeagueClientStatus {
                        connected: false,
                        gameflow_phase: None,
                        lockfile_path: Some(credentials.lockfile_path),
                        error: Some(error),
                    };
                }
            };

            match lcu_get::<String>(&client, &credentials, "/lol-gameflow/v1/gameflow-phase").await
            {
                Ok(phase) => LeagueClientStatus {
                    connected: true,
                    gameflow_phase: Some(phase),
                    lockfile_path: Some(credentials.lockfile_path),
                    error: None,
                },
                Err(error) => LeagueClientStatus {
                    connected: false,
                    gameflow_phase: None,
                    lockfile_path: Some(credentials.lockfile_path),
                    error: Some(error),
                },
            }
        }
        Err(error) => LeagueClientStatus {
            connected: false,
            gameflow_phase: None,
            lockfile_path: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn apply_recommendation_to_lol(
    request: ApplyRecommendationRequest,
) -> Result<ApplyRecommendationResponse, String> {
    validate_apply_request(&request)?;

    let credentials = read_lcu_credentials()?;
    let client = build_lcu_client()?;
    let gameflow_phase: String =
        lcu_get(&client, &credentials, "/lol-gameflow/v1/gameflow-phase").await?;

    if gameflow_phase != "ChampSelect" {
        return Err(format!(
            "Champion select is not active. Current gameflow phase: {}",
            gameflow_phase
        ));
    }

    let rune_page = apply_runes(&client, &credentials, &request).await?;
    let player = apply_summoner_spells(&client, &credentials, &request).await?;

    Ok(ApplyRecommendationResponse {
        success: true,
        champion: request.champion,
        role: request.role,
        gameflow_phase,
        rune_page_id: rune_page.id,
        rune_page_name: rune_page.name,
        spell1_id: player.spell1_id,
        spell2_id: player.spell2_id,
        summoner_id: player.summoner_id,
    })
}

fn validate_apply_request(request: &ApplyRecommendationRequest) -> Result<(), String> {
    if request.selected_perk_ids.len() != 9 {
        return Err("Rune page must contain exactly 9 selected perk ids.".to_string());
    }

    if request.selected_perk_ids.iter().any(|id| *id <= 0) {
        return Err("Rune page contains invalid selected perk id.".to_string());
    }

    if request.summoner_spell_ids[0] <= 0 || request.summoner_spell_ids[1] <= 0 {
        return Err("Summoner spell ids must be positive.".to_string());
    }

    if request.summoner_spell_ids[0] == request.summoner_spell_ids[1] {
        return Err("Summoner spell ids must be different.".to_string());
    }

    Ok(())
}

async fn apply_runes(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    request: &ApplyRecommendationRequest,
) -> Result<LcuRunePage, String> {
    let pages: Vec<LcuRunePage> = lcu_get(client, credentials, "/lol-perks/v1/pages").await?;

    for page in pages.iter().filter(|page| page.name.starts_with("Liga")) {
        lcu_delete(
            client,
            credentials,
            &format!("/lol-perks/v1/pages/{}", page.id),
        )
        .await?;
    }

    let primary_style_id = rune_style_id(&request.primary_style)?;
    let sub_style_id = rune_style_id(&request.sub_style)?;
    let page_name = format!("Liga - {} {}", request.champion, request.role);

    let created: LcuRunePage = lcu_post(
        client,
        credentials,
        "/lol-perks/v1/pages",
        &CreateRunePageRequest {
            name: page_name,
            primary_style_id,
            sub_style_id,
            selected_perk_ids: request.selected_perk_ids.clone(),
            current: true,
        },
    )
    .await?;

    let current: LcuRunePage = lcu_get(client, credentials, "/lol-perks/v1/currentpage").await?;

    if current.id != created.id
        || current.primary_style_id != primary_style_id
        || current.sub_style_id != sub_style_id
        || current.selected_perk_ids != request.selected_perk_ids
    {
        return Err("Rune page was created, but verification failed.".to_string());
    }

    Ok(current)
}

async fn apply_summoner_spells(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    request: &ApplyRecommendationRequest,
) -> Result<ChampSelectPlayer, String> {
    lcu_patch(
        client,
        credentials,
        "/lol-champ-select/v1/session/my-selection",
        &MySelectionPatch {
            spell1_id: request.summoner_spell_ids[0],
            spell2_id: request.summoner_spell_ids[1],
        },
    )
    .await?;

    let session: ChampSelectSession =
        lcu_get(client, credentials, "/lol-champ-select/v1/session").await?;
    let player = session
        .my_team
        .into_iter()
        .find(|player| player.cell_id == session.local_player_cell_id)
        .ok_or_else(|| "Could not find local player in champion select session.".to_string())?;

    if player.spell1_id != request.summoner_spell_ids[0]
        || player.spell2_id != request.summoner_spell_ids[1]
    {
        return Err("Summoner spells were sent, but verification failed.".to_string());
    }

    Ok(player)
}

#[tauri::command]
pub async fn auto_accept_ready_check() -> Result<AutoActionResponse, String> {
    let credentials = read_lcu_credentials()?;
    let client = build_lcu_client()?;
    let gameflow_phase: String =
        lcu_get(&client, &credentials, "/lol-gameflow/v1/gameflow-phase").await?;

    if gameflow_phase != "ReadyCheck" {
        return Ok(AutoActionResponse {
            success: false,
            action: "accept".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: None,
            status_code: None,
            body: None,
            reason: Some("not_ready_check".to_string()),
        });
    }

    match lcu_post_no_body(&client, &credentials, "/lol-matchmaking/v1/ready-check/accept").await {
        Ok(()) => Ok(AutoActionResponse {
            success: true,
            action: "accept".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: None,
            status_code: Some(200),
            body: None,
            reason: None,
        }),
        Err((status_code, body)) => Ok(AutoActionResponse {
            success: false,
            action: "accept".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: None,
            status_code,
            body,
            reason: Some("accept_failed".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn auto_ban_champion(request: AutoBanRequest) -> Result<AutoActionResponse, String> {
    let credentials = read_lcu_credentials()?;
    let client = build_lcu_client()?;
    let gameflow_phase: String =
        lcu_get(&client, &credentials, "/lol-gameflow/v1/gameflow-phase").await?;

    if gameflow_phase != "ChampSelect" {
        return Ok(AutoActionResponse {
            success: false,
            action: "ban".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: None,
            status_code: None,
            body: None,
            reason: Some("not_champ_select".to_string()),
        });
    }

    let session: ChampSelectSession =
        lcu_get(&client, &credentials, "/lol-champ-select/v1/session").await?;
    let action = session
        .actions
        .iter()
        .flat_map(|phase| phase.iter())
        .find(|action| {
            action.actor_cell_id == session.local_player_cell_id
                && action.action_type == "ban"
                && (action.is_in_progress || !action.completed)
                && !action.completed
        });

    let Some(action) = action else {
        return Ok(AutoActionResponse {
            success: false,
            action: "ban".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: Some(session.local_player_cell_id),
            status_code: None,
            body: None,
            reason: Some("ban_action_not_found".to_string()),
        });
    };

    let banned: std::collections::HashSet<i64> = session
        .bans
        .as_ref()
        .map(|bans| {
            bans.my_team_bans
                .iter()
                .chain(bans.their_team_bans.iter())
                .copied()
                .collect()
        })
        .unwrap_or_default();

    let candidates = [request.preferred_ban_champion_id, request.backup_ban_champion_id]
        .into_iter()
        .flatten()
        .filter(|champion_id| *champion_id > 0 && !banned.contains(champion_id));

    for champion_id in candidates {
        match lcu_patch_with_status(
            &client,
            &credentials,
            &format!("/lol-champ-select/v1/session/actions/{}", action.id),
            &serde_json::json!({
                "championId": champion_id,
                "completed": true
            }),
        )
        .await
        {
            Ok(()) => {
                return Ok(AutoActionResponse {
                    success: true,
                    action: "ban".to_string(),
                    gameflow_phase,
                    action_id: Some(action.id),
                    champion_id: Some(champion_id),
                    local_player_cell_id: Some(session.local_player_cell_id),
                    status_code: Some(200),
                    body: None,
                    reason: None,
                })
            }
            Err((status_code, body)) => {
                if request.backup_ban_champion_id == Some(champion_id) {
                    return Ok(AutoActionResponse {
                        success: false,
                        action: "ban".to_string(),
                        gameflow_phase,
                        action_id: Some(action.id),
                        champion_id: Some(champion_id),
                        local_player_cell_id: Some(session.local_player_cell_id),
                        status_code,
                        body,
                        reason: Some("ban_failed".to_string()),
                    });
                }
            }
        }
    }

    Ok(AutoActionResponse {
        success: false,
        action: "ban".to_string(),
        gameflow_phase,
        action_id: Some(action.id),
        champion_id: None,
        local_player_cell_id: Some(session.local_player_cell_id),
        status_code: None,
        body: None,
        reason: Some("no_available_candidate".to_string()),
    })
}

#[tauri::command]
pub async fn auto_pick_champion(request: AutoPickRequest) -> Result<AutoActionResponse, String> {
    let credentials = read_lcu_credentials()?;
    let client = build_lcu_client()?;
    let gameflow_phase: String =
        lcu_get(&client, &credentials, "/lol-gameflow/v1/gameflow-phase").await?;

    if gameflow_phase != "ChampSelect" {
        return Ok(AutoActionResponse {
            success: false,
            action: "pick".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: None,
            status_code: None,
            body: None,
            reason: Some("not_champ_select".to_string()),
        });
    }

    let session: ChampSelectSession =
        lcu_get(&client, &credentials, "/lol-champ-select/v1/session").await?;
    let action = session
        .actions
        .iter()
        .flat_map(|phase| phase.iter())
        .find(|action| {
            action.actor_cell_id == session.local_player_cell_id
                && action.action_type == "pick"
                && (action.is_in_progress || !action.completed)
                && !action.completed
        });

    let Some(action) = action else {
        return Ok(AutoActionResponse {
            success: false,
            action: "pick".to_string(),
            gameflow_phase,
            action_id: None,
            champion_id: None,
            local_player_cell_id: Some(session.local_player_cell_id),
            status_code: None,
            body: None,
            reason: Some("pick_action_not_found".to_string()),
        });
    };

    let unavailable: std::collections::HashSet<i64> = session
        .my_team
        .iter()
        .chain(session.their_team.iter())
        .map(|player| player.champion_id)
        .filter(|champion_id| *champion_id > 0)
        .collect();

    let candidates = std::iter::once(request.preferred_pick_champion_id)
        .chain(request.backup_pick_champion_ids.into_iter().map(Some))
        .flatten()
        .filter(|champion_id| *champion_id > 0 && !unavailable.contains(champion_id));

    for champion_id in candidates {
        match lcu_patch_with_status(
            &client,
            &credentials,
            &format!("/lol-champ-select/v1/session/actions/{}", action.id),
            &serde_json::json!({
                "championId": champion_id,
                "completed": request.confirm_pick
            }),
        )
        .await
        {
            Ok(()) => {
                return Ok(AutoActionResponse {
                    success: true,
                    action: "pick".to_string(),
                    gameflow_phase,
                    action_id: Some(action.id),
                    champion_id: Some(champion_id),
                    local_player_cell_id: Some(session.local_player_cell_id),
                    status_code: Some(200),
                    body: None,
                    reason: None,
                })
            }
            Err((status_code, body)) => {
                continue_or_return_pick_failure(
                    champion_id,
                    request.preferred_pick_champion_id,
                    action.id,
                    session.local_player_cell_id,
                    &gameflow_phase,
                    status_code,
                    body,
                )?;
            }
        }
    }

    Ok(AutoActionResponse {
        success: false,
        action: "pick".to_string(),
        gameflow_phase,
        action_id: Some(action.id),
        champion_id: None,
        local_player_cell_id: Some(session.local_player_cell_id),
        status_code: None,
        body: None,
        reason: Some("no_available_candidate".to_string()),
    })
}

fn rune_style_id(style: &str) -> Result<i64, String> {
    match style.trim().to_lowercase().as_str() {
        "precision" => Ok(8000),
        "domination" => Ok(8100),
        "sorcery" => Ok(8200),
        "inspiration" => Ok(8300),
        "resolve" => Ok(8400),
        _ => Err(format!("Unknown rune style: {}", style)),
    }
}

fn build_lcu_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|error| format!("Could not build LCU HTTP client: {}", error))
}

async fn lcu_get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
) -> Result<T, String> {
    lcu_request(client.get(lcu_url(credentials, endpoint)), credentials)
        .await?
        .json::<T>()
        .await
        .map_err(|error| format!("Could not parse LCU response from {}: {}", endpoint, error))
}

async fn lcu_post<T: serde::de::DeserializeOwned, B: serde::Serialize + ?Sized>(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
    body: &B,
) -> Result<T, String> {
    lcu_request(
        client.post(lcu_url(credentials, endpoint)).json(body),
        credentials,
    )
    .await?
    .json::<T>()
    .await
    .map_err(|error| format!("Could not parse LCU response from {}: {}", endpoint, error))
}

async fn lcu_patch<B: serde::Serialize + ?Sized>(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
    body: &B,
) -> Result<(), String> {
    lcu_request(
        client.patch(lcu_url(credentials, endpoint)).json(body),
        credentials,
    )
    .await
    .map(|_| ())
}

async fn lcu_post_no_body(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
) -> Result<(), (Option<u16>, Option<String>)> {
    let response = client
        .post(lcu_url(credentials, endpoint))
        .basic_auth("riot", Some(&credentials.password))
        .send()
        .await
        .map_err(|error| (None, Some(format!("LCU request failed: {}", error))))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err((Some(status.as_u16()), Some(body)));
    }

    Ok(())
}

async fn lcu_patch_with_status<B: serde::Serialize + ?Sized>(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
    body: &B,
) -> Result<(), (Option<u16>, Option<String>)> {
    let response = client
        .patch(lcu_url(credentials, endpoint))
        .basic_auth("riot", Some(&credentials.password))
        .json(body)
        .send()
        .await
        .map_err(|error| (None, Some(format!("LCU request failed: {}", error))))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err((Some(status.as_u16()), Some(body)));
    }

    Ok(())
}

async fn lcu_delete(
    client: &reqwest::Client,
    credentials: &LcuCredentials,
    endpoint: &str,
) -> Result<(), String> {
    lcu_request(client.delete(lcu_url(credentials, endpoint)), credentials)
        .await
        .map(|_| ())
}

async fn lcu_request(
    request: reqwest::RequestBuilder,
    credentials: &LcuCredentials,
) -> Result<reqwest::Response, String> {
    let response = request
        .basic_auth("riot", Some(&credentials.password))
        .send()
        .await
        .map_err(|error| format!("LCU request failed: {}", error))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("LCU returned HTTP {}: {}", status, body));
    }

    Ok(response)
}

fn lcu_url(credentials: &LcuCredentials, endpoint: &str) -> String {
    format!(
        "{}://127.0.0.1:{}{}",
        credentials.protocol, credentials.port, endpoint
    )
}

fn read_lcu_credentials() -> Result<LcuCredentials, String> {
    let lockfile_path = find_lockfile_path()?;
    let content = std::fs::read_to_string(&lockfile_path)
        .map_err(|error| format!("Could not read League lockfile: {}", error))?;
    let parts: Vec<&str> = content.trim().split(':').collect();

    if parts.len() != 5 {
        return Err("Invalid League lockfile format.".to_string());
    }

    let port = parts[2]
        .parse::<u16>()
        .map_err(|_| "Invalid League lockfile port.".to_string())?;
    let password = parts[3].to_string();
    let protocol = parts[4].to_string();

    if password.is_empty() {
        return Err("League lockfile password is empty.".to_string());
    }

    if protocol != "http" && protocol != "https" {
        return Err(format!(
            "Unsupported League lockfile protocol: {}",
            protocol
        ));
    }

    Ok(LcuCredentials {
        lockfile_path,
        protocol,
        port,
        password,
    })
}

fn find_lockfile_path() -> Result<String, String> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("LEAGUE_LOCKFILE_PATH") {
        candidates.push(path);
    }

    if let Ok(dir) = std::env::var("LEAGUE_CLIENT_DIR") {
        candidates.push(format!("{}\\lockfile", dir.trim_end_matches('\\')));
    }

    candidates.push("C:\\Riot Games\\League of Legends\\lockfile".to_string());
    candidates.push("C:\\Program Files\\Riot Games\\League of Legends\\lockfile".to_string());
    candidates.push("C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile".to_string());

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(format!(
            "{}\\Riot Games\\League of Legends\\lockfile",
            user_profile
        ));
        candidates.push(format!(
            "{}\\Games\\Riot Games\\League of Legends\\lockfile",
            user_profile
        ));
    }

    candidates
        .into_iter()
        .find(|candidate| std::path::Path::new(candidate).is_file())
        .ok_or_else(|| "League Client lockfile was not found.".to_string())
}

fn continue_or_return_pick_failure(
    champion_id: i64,
    preferred_pick_champion_id: Option<i64>,
    action_id: i64,
    local_player_cell_id: i64,
    gameflow_phase: &str,
    status_code: Option<u16>,
    body: Option<String>,
) -> Result<(), String> {
    if preferred_pick_champion_id == Some(champion_id) {
        return Ok(());
    }

    let _ = (
        action_id,
        local_player_cell_id,
        gameflow_phase,
        status_code,
        body,
    );
    Ok(())
}
