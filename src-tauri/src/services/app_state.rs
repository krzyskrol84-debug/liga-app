use std::sync::Mutex;

use crate::models::app_status::AppStatus;

#[derive(Default)]
pub struct AppState {
    status: Mutex<AppStatus>,
}

impl AppState {
    pub fn status(&self) -> AppStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default()
    }
}
