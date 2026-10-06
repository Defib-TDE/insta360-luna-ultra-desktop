mod diagnostics;
mod liveview;
mod luna;
mod webcam;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(luna::LunaState::default())
        .manage(liveview::LiveViewState::default())
        .manage(webcam::WebcamState::default())
        .invoke_handler(tauri::generate_handler![
            luna::luna_connect,
            luna::luna_disconnect,
            luna::luna_status,
            luna::luna_connection_diagnostics,
            luna::luna_delete_files,
            luna::luna_command,
            liveview::luna_liveview_start,
            liveview::luna_liveview_stop,
            liveview::luna_liveview_stats,
            webcam::webcam_environment,
            webcam::webcam_open_help,
            webcam::webcam_setup,
            webcam::webcam_start,
            webcam::webcam_stop,
            webcam::webcam_status,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                tauri::async_runtime::block_on(webcam::shutdown(
                    &app.state::<webcam::WebcamState>(),
                ));
            }
        });
}
