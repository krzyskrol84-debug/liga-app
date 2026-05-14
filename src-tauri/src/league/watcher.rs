use tauri::{AppHandle, Emitter};

use crate::events::APP_STATUS_CHANGED;
use crate::models::app_status::AppStatus;

pub fn emit_status(app: &AppHandle, status: AppStatus) {
    let _ = app.emit(APP_STATUS_CHANGED, status);
}
