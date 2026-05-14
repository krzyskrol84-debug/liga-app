use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChampSelectSnapshot {
    pub active: bool,
    pub champion_id: Option<i64>,
    pub assigned_position: Option<String>,
}
