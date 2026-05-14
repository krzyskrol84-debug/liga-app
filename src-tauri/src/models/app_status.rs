use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub league_client_connected: bool,
    pub champ_select_active: bool,
    pub detected_champion: Option<String>,
    pub detected_role: Option<String>,
    pub auto_apply_enabled: bool,
    pub database_ready: bool,
}

impl Default for AppStatus {
    fn default() -> Self {
        Self {
            league_client_connected: false,
            champ_select_active: false,
            detected_champion: None,
            detected_role: None,
            auto_apply_enabled: false,
            database_ready: true,
        }
    }
}
