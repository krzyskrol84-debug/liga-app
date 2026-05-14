mod commands;
mod db;
mod events;
mod league;
mod models;
mod services;

use commands::{
    add_history, apply_recommendation_to_lol, auto_accept_ready_check, auto_ban_champion,
    auto_pick_champion, check_league_client_status, clear_app_logs, clear_riot_data_cache,
    get_app_status, get_champion, get_database_info, get_riot_api_status, get_riot_static_data,
    get_setting, list_app_logs, list_champions, list_history, list_patches, list_recommendations,
    list_settings, refresh_riot_static_data, set_setting, test_riot_api, upsert_champion,
    upsert_patch, upsert_recommendation, write_app_log,
};
use services::app_state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let database = db::init(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            check_league_client_status,
            apply_recommendation_to_lol,
            auto_accept_ready_check,
            auto_ban_champion,
            auto_pick_champion,
            get_database_info,
            upsert_patch,
            list_patches,
            upsert_champion,
            list_champions,
            get_champion,
            upsert_recommendation,
            list_recommendations,
            set_setting,
            get_setting,
            list_settings,
            add_history,
            list_history,
            write_app_log,
            list_app_logs,
            clear_app_logs,
            get_riot_static_data,
            refresh_riot_static_data,
            clear_riot_data_cache,
            get_riot_api_status,
            test_riot_api
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
