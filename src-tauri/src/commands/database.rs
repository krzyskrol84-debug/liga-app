use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::db::Database;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRecord {
    pub version: String,
    pub is_current: bool,
    pub released_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionRecord {
    pub champion_id: i64,
    pub champion_key: String,
    pub name: String,
    pub title: Option<String>,
    pub roles: Vec<String>,
    pub image_url: Option<String>,
    pub patch: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationRecord {
    pub id: Option<i64>,
    pub champion_id: i64,
    pub role: String,
    pub primary_style: String,
    pub sub_style: String,
    pub selected_perk_ids: Vec<i64>,
    pub summoner_spell_ids: [i64; 2],
    pub win_rate: f64,
    pub pick_rate: f64,
    pub games_count: i64,
    pub patch: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRecord {
    pub key: String,
    pub value: serde_json::Value,
    pub value_type: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: Option<i64>,
    pub champion_id: Option<i64>,
    pub champion_name: String,
    pub role: String,
    pub patch: String,
    pub action: String,
    pub success: bool,
    pub message: Option<String>,
    pub recommendation: Option<serde_json::Value>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogRecord {
    pub id: Option<i64>,
    pub level: String,
    pub category: String,
    pub message: String,
    pub context: Option<serde_json::Value>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub path: String,
    pub migrations: Vec<MigrationRecord>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

#[tauri::command]
pub fn get_database_info(db: State<'_, Database>) -> Result<DatabaseInfo, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let mut statement = connection
        .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
        .map_err(to_string_error)?;
    let migrations = statement
        .query_map([], |row| {
            Ok(MigrationRecord {
                version: row.get(0)?,
                name: row.get(1)?,
                applied_at: row.get(2)?,
            })
        })
        .map_err(to_string_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string_error)?;

    Ok(DatabaseInfo {
        path: db.path().display().to_string(),
        migrations,
    })
}

#[tauri::command]
pub fn upsert_patch(db: State<'_, Database>, patch: PatchRecord) -> Result<(), String> {
    let connection = db.connect().map_err(to_string_error)?;

    if patch.is_current {
        connection
            .execute("UPDATE patches SET is_current = 0", [])
            .map_err(to_string_error)?;
    }

    connection
        .execute(
            r#"
            INSERT INTO patches (version, is_current, released_at, updated_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            ON CONFLICT(version) DO UPDATE SET
              is_current = excluded.is_current,
              released_at = excluded.released_at,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                patch.version,
                bool_to_i64(patch.is_current),
                patch.released_at
            ],
        )
        .map_err(to_string_error)?;

    Ok(())
}

#[tauri::command]
pub fn list_patches(db: State<'_, Database>) -> Result<Vec<PatchRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let mut statement = connection
        .prepare("SELECT version, is_current, released_at FROM patches ORDER BY created_at DESC")
        .map_err(to_string_error)?;

    let rows = statement
        .query_map([], |row| {
            Ok(PatchRecord {
                version: row.get(0)?,
                is_current: int_to_bool(row.get::<_, i64>(1)?),
                released_at: row.get(2)?,
            })
        })
        .map_err(to_string_error)?;
    let patches = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
    patches
}

#[tauri::command]
pub fn upsert_champion(db: State<'_, Database>, champion: ChampionRecord) -> Result<(), String> {
    let connection = db.connect().map_err(to_string_error)?;
    let roles_json = serde_json::to_string(&champion.roles).map_err(to_string_error)?;

    connection
        .execute(
            r#"
            INSERT INTO champions (
              champion_id, champion_key, name, title, roles_json, image_url, patch, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
            ON CONFLICT(champion_id) DO UPDATE SET
              champion_key = excluded.champion_key,
              name = excluded.name,
              title = excluded.title,
              roles_json = excluded.roles_json,
              image_url = excluded.image_url,
              patch = excluded.patch,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                champion.champion_id,
                champion.champion_key,
                champion.name,
                champion.title,
                roles_json,
                champion.image_url,
                champion.patch
            ],
        )
        .map_err(to_string_error)?;

    Ok(())
}

#[tauri::command]
pub fn list_champions(db: State<'_, Database>) -> Result<Vec<ChampionRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT champion_id, champion_key, name, title, roles_json, image_url, patch
            FROM champions
            ORDER BY name
            "#,
        )
        .map_err(to_string_error)?;

    let rows = statement
        .query_map([], read_champion)
        .map_err(to_string_error)?;
    let champions = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
    champions
}

#[tauri::command]
pub fn get_champion(
    db: State<'_, Database>,
    champion_id: i64,
) -> Result<Option<ChampionRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    connection
        .query_row(
            r#"
            SELECT champion_id, champion_key, name, title, roles_json, image_url, patch
            FROM champions
            WHERE champion_id = ?1
            "#,
            params![champion_id],
            read_champion,
        )
        .optional()
        .map_err(to_string_error)
}

#[tauri::command]
pub fn upsert_recommendation(
    db: State<'_, Database>,
    recommendation: RecommendationRecord,
) -> Result<(), String> {
    validate_recommendation(&recommendation)?;

    let connection = db.connect().map_err(to_string_error)?;
    let selected_perk_ids_json =
        serde_json::to_string(&recommendation.selected_perk_ids).map_err(to_string_error)?;
    let summoner_spell_ids_json =
        serde_json::to_string(&recommendation.summoner_spell_ids).map_err(to_string_error)?;
    let source = recommendation.source.unwrap_or_else(|| "local".to_string());

    connection
        .execute(
            r#"
            INSERT INTO recommendations (
              champion_id, role, primary_style, sub_style, selected_perk_ids_json,
              summoner_spell_ids_json, win_rate, pick_rate, games_count, patch, source, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, CURRENT_TIMESTAMP)
            ON CONFLICT(champion_id, role, patch) DO UPDATE SET
              primary_style = excluded.primary_style,
              sub_style = excluded.sub_style,
              selected_perk_ids_json = excluded.selected_perk_ids_json,
              summoner_spell_ids_json = excluded.summoner_spell_ids_json,
              win_rate = excluded.win_rate,
              pick_rate = excluded.pick_rate,
              games_count = excluded.games_count,
              source = excluded.source,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                recommendation.champion_id,
                recommendation.role,
                recommendation.primary_style,
                recommendation.sub_style,
                selected_perk_ids_json,
                summoner_spell_ids_json,
                recommendation.win_rate,
                recommendation.pick_rate,
                recommendation.games_count,
                recommendation.patch,
                source
            ],
        )
        .map_err(to_string_error)?;

    Ok(())
}

#[tauri::command]
pub fn list_recommendations(
    db: State<'_, Database>,
    champion_id: Option<i64>,
    role: Option<String>,
) -> Result<Vec<RecommendationRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;

    let (sql, bind_champion, bind_role) = match (champion_id, role) {
        (Some(champion_id), Some(role)) => (
            r#"
            SELECT id, champion_id, role, primary_style, sub_style, selected_perk_ids_json,
                   summoner_spell_ids_json, win_rate, pick_rate, games_count, patch, source
            FROM recommendations
            WHERE champion_id = ?1 AND role = ?2
            ORDER BY patch DESC, win_rate DESC
            "#,
            Some(champion_id),
            Some(role),
        ),
        (Some(champion_id), None) => (
            r#"
            SELECT id, champion_id, role, primary_style, sub_style, selected_perk_ids_json,
                   summoner_spell_ids_json, win_rate, pick_rate, games_count, patch, source
            FROM recommendations
            WHERE champion_id = ?1
            ORDER BY patch DESC, win_rate DESC
            "#,
            Some(champion_id),
            None,
        ),
        (None, Some(role)) => (
            r#"
            SELECT id, champion_id, role, primary_style, sub_style, selected_perk_ids_json,
                   summoner_spell_ids_json, win_rate, pick_rate, games_count, patch, source
            FROM recommendations
            WHERE role = ?1
            ORDER BY patch DESC, win_rate DESC
            "#,
            None,
            Some(role),
        ),
        (None, None) => (
            r#"
            SELECT id, champion_id, role, primary_style, sub_style, selected_perk_ids_json,
                   summoner_spell_ids_json, win_rate, pick_rate, games_count, patch, source
            FROM recommendations
            ORDER BY patch DESC, win_rate DESC
            "#,
            None,
            None,
        ),
    };

    let mut statement = connection.prepare(sql).map_err(to_string_error)?;

    let recommendations = match (bind_champion, bind_role) {
        (Some(champion_id), Some(role)) => {
            let rows = statement
                .query_map(params![champion_id, role], read_recommendation)
                .map_err(to_string_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error)
        }
        (Some(champion_id), None) => {
            let rows = statement
                .query_map(params![champion_id], read_recommendation)
                .map_err(to_string_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error)
        }
        (None, Some(role)) => {
            let rows = statement
                .query_map(params![role], read_recommendation)
                .map_err(to_string_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error)
        }
        (None, None) => {
            let rows = statement
                .query_map([], read_recommendation)
                .map_err(to_string_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error)
        }
    };
    recommendations
}

#[tauri::command]
pub fn set_setting(db: State<'_, Database>, setting: SettingRecord) -> Result<(), String> {
    let connection = db.connect().map_err(to_string_error)?;
    let value = serde_json::to_string(&setting.value).map_err(to_string_error)?;

    connection
        .execute(
            r#"
            INSERT INTO settings (key, value, value_type, updated_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              value_type = excluded.value_type,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![setting.key, value, setting.value_type],
        )
        .map_err(to_string_error)?;

    Ok(())
}

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<SettingRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    connection
        .query_row(
            "SELECT key, value, value_type FROM settings WHERE key = ?1",
            params![key],
            |row| {
                let value_raw: String = row.get(1)?;
                let value = serde_json::from_str(&value_raw)
                    .unwrap_or(serde_json::Value::String(value_raw));

                Ok(SettingRecord {
                    key: row.get(0)?,
                    value,
                    value_type: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(to_string_error)
}

#[tauri::command]
pub fn list_settings(db: State<'_, Database>) -> Result<Vec<SettingRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let mut statement = connection
        .prepare("SELECT key, value, value_type FROM settings ORDER BY key")
        .map_err(to_string_error)?;

    let rows = statement
        .query_map([], |row| {
            let value_raw: String = row.get(1)?;
            let value =
                serde_json::from_str(&value_raw).unwrap_or(serde_json::Value::String(value_raw));

            Ok(SettingRecord {
                key: row.get(0)?,
                value,
                value_type: row.get(2)?,
            })
        })
        .map_err(to_string_error)?;
    let settings = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
    settings
}

#[tauri::command]
pub fn add_history(db: State<'_, Database>, history: HistoryRecord) -> Result<i64, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let recommendation_json = history
        .recommendation
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(to_string_error)?;

    connection
        .execute(
            r#"
            INSERT INTO history (
              champion_id, champion_name, role, patch, action, success, message, recommendation_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                history.champion_id,
                history.champion_name,
                history.role,
                history.patch,
                history.action,
                bool_to_i64(history.success),
                history.message,
                recommendation_json
            ],
        )
        .map_err(to_string_error)?;

    Ok(connection.last_insert_rowid())
}

#[tauri::command]
pub fn list_history(
    db: State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<HistoryRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, champion_id, champion_name, role, patch, action, success,
                   message, recommendation_json, created_at
            FROM history
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )
        .map_err(to_string_error)?;

    let rows = statement
        .query_map(params![limit], read_history)
        .map_err(to_string_error)?;
    let history = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
    history
}

#[tauri::command]
pub fn write_app_log(db: State<'_, Database>, log: AppLogRecord) -> Result<i64, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let context_json = log
        .context
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(to_string_error)?;
    let message = if log.category.trim().is_empty() {
        log.message
    } else {
        format!("[{}] {}", log.category, log.message)
    };

    connection
        .execute(
            r#"
            INSERT INTO app_logs (level, message, context_json, created_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            "#,
            params![log.level, message, context_json],
        )
        .map_err(to_string_error)?;

    Ok(connection.last_insert_rowid())
}

#[tauri::command]
pub fn list_app_logs(
    db: State<'_, Database>,
    limit: Option<i64>,
    level: Option<String>,
) -> Result<Vec<AppLogRecord>, String> {
    let connection = db.connect().map_err(to_string_error)?;
    let limit = limit.unwrap_or(100).clamp(1, 1000);

    if let Some(level) = level {
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, level, message, context_json, created_at
                FROM app_logs
                WHERE level = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT ?2
                "#,
            )
            .map_err(to_string_error)?;

        let rows = statement
            .query_map(params![level, limit], read_app_log)
            .map_err(to_string_error)?;
        let logs = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
        return logs;
    }

    let mut statement = connection
        .prepare(
            r#"
            SELECT id, level, message, context_json, created_at
            FROM app_logs
            ORDER BY created_at DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(to_string_error)?;

    let rows = statement
        .query_map(params![limit], read_app_log)
        .map_err(to_string_error)?;
    let logs = rows.collect::<Result<Vec<_>, _>>().map_err(to_string_error);
    logs
}

#[tauri::command]
pub fn clear_app_logs(db: State<'_, Database>) -> Result<(), String> {
    let connection = db.connect().map_err(to_string_error)?;
    connection
        .execute("DELETE FROM app_logs", [])
        .map_err(to_string_error)?;
    Ok(())
}

fn read_champion(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChampionRecord> {
    let roles_json: String = row.get(4)?;
    let roles = serde_json::from_str(&roles_json).unwrap_or_default();

    Ok(ChampionRecord {
        champion_id: row.get(0)?,
        champion_key: row.get(1)?,
        name: row.get(2)?,
        title: row.get(3)?,
        roles,
        image_url: row.get(5)?,
        patch: row.get(6)?,
    })
}

fn read_recommendation(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecommendationRecord> {
    let selected_perk_ids_json: String = row.get(5)?;
    let summoner_spell_ids_json: String = row.get(6)?;

    Ok(RecommendationRecord {
        id: row.get(0)?,
        champion_id: row.get(1)?,
        role: row.get(2)?,
        primary_style: row.get(3)?,
        sub_style: row.get(4)?,
        selected_perk_ids: serde_json::from_str(&selected_perk_ids_json).unwrap_or_default(),
        summoner_spell_ids: serde_json::from_str(&summoner_spell_ids_json).unwrap_or([0, 0]),
        win_rate: row.get(7)?,
        pick_rate: row.get(8)?,
        games_count: row.get(9)?,
        patch: row.get(10)?,
        source: row.get(11)?,
    })
}

fn read_history(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRecord> {
    let recommendation_raw: Option<String> = row.get(8)?;
    let recommendation =
        recommendation_raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());

    Ok(HistoryRecord {
        id: row.get(0)?,
        champion_id: row.get(1)?,
        champion_name: row.get(2)?,
        role: row.get(3)?,
        patch: row.get(4)?,
        action: row.get(5)?,
        success: int_to_bool(row.get::<_, i64>(6)?),
        message: row.get(7)?,
        recommendation,
        created_at: row.get(9)?,
    })
}

fn read_app_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<AppLogRecord> {
    let message: String = row.get(2)?;
    let context_raw: Option<String> = row.get(3)?;
    let context = context_raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let (category, message) = parse_log_category(message);

    Ok(AppLogRecord {
        id: row.get(0)?,
        level: row.get(1)?,
        category,
        message,
        context,
        created_at: row.get(4)?,
    })
}

fn parse_log_category(message: String) -> (String, String) {
    if let Some(rest) = message.strip_prefix('[') {
        if let Some((category, message)) = rest.split_once("] ") {
            return (category.to_string(), message.to_string());
        }
    }

    ("app".to_string(), message)
}

fn validate_recommendation(recommendation: &RecommendationRecord) -> Result<(), String> {
    if recommendation.selected_perk_ids.len() != 9 {
        return Err("Recommendation must contain exactly 9 selected perk ids.".to_string());
    }

    if recommendation.summoner_spell_ids[0] <= 0 || recommendation.summoner_spell_ids[1] <= 0 {
        return Err("Recommendation summoner spell ids must be positive.".to_string());
    }

    Ok(())
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

fn to_string_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
