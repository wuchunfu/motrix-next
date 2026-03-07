use crate::engine;
use crate::tray::TrayMenuState;
use serde_json::Value;
use tauri::window::ProgressBarState;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

/// Reads all user preferences from the `user.json` store.
#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<Value, String> {
    let store = app.store("user.json").map_err(|e| e.to_string())?;
    let entries: serde_json::Map<String, Value> = store
        .entries()
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect();
    Ok(Value::Object(entries))
}

/// Merges the given key-value pairs into the `user.json` store.
#[tauri::command]
pub fn save_preference(app: AppHandle, config: Value) -> Result<(), String> {
    let store = app.store("user.json").map_err(|e| e.to_string())?;
    if let Some(obj) = config.as_object() {
        for (key, value) in obj {
            store.set(key.clone(), value.clone());
        }
    }
    Ok(())
}

/// Reads all system-level configuration from the `system.json` store.
#[tauri::command]
pub fn get_system_config(app: AppHandle) -> Result<Value, String> {
    let store = app.store("system.json").map_err(|e| e.to_string())?;
    let entries: serde_json::Map<String, Value> = store
        .entries()
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect();
    Ok(Value::Object(entries))
}

/// Merges the given key-value pairs into the `system.json` store.
#[tauri::command]
pub fn save_system_config(app: AppHandle, config: Value) -> Result<(), String> {
    let store = app.store("system.json").map_err(|e| e.to_string())?;
    if let Some(obj) = config.as_object() {
        for (key, value) in obj {
            store.set(key.clone(), value.clone());
        }
    }
    Ok(())
}

/// Starts the aria2c engine process with current system configuration.
#[tauri::command]
pub fn start_engine_command(app: AppHandle) -> Result<(), String> {
    let config = get_system_config(app.clone())?;
    engine::start_engine(&app, &config)
}

/// Gracefully stops the running aria2c engine process.
#[tauri::command]
pub fn stop_engine_command(app: AppHandle) -> Result<(), String> {
    engine::stop_engine(&app)
}

/// Stops and restarts the aria2c engine with current system configuration.
#[tauri::command]
pub fn restart_engine_command(app: AppHandle) -> Result<(), String> {
    let config = get_system_config(app.clone())?;
    engine::restart_engine(&app, &config)
}

/// Clears both user and system stores, resetting the app to defaults.
#[tauri::command]
pub fn factory_reset(app: AppHandle) -> Result<(), String> {
    let user_store = app.store("user.json").map_err(|e| e.to_string())?;
    user_store.clear();
    let system_store = app.store("system.json").map_err(|e| e.to_string())?;
    system_store.clear();
    Ok(())
}

/// Updates the system tray title text (macOS menu bar display).
#[tauri::command]
pub fn update_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(Some(&title)).map_err(|e| e.to_string())?;
        // Workaround: re-set icon after set_title to prevent macOS icon disappearing (Tauri/tao bug)
        if let Some(icon) = app.default_window_icon() {
            let _ = tray.set_icon(Some(icon.clone()));
        }
    }
    Ok(())
}

/// Updates localized labels on tray menu items by their IDs.
#[tauri::command]
pub fn update_tray_menu_labels(app: AppHandle, labels: Value) -> Result<(), String> {
    let state = app.state::<TrayMenuState>();
    let items = state.items.lock().map_err(|e| e.to_string())?;
    if let Some(obj) = labels.as_object() {
        for (id, text) in obj {
            if let Some(item) = items.get(id.as_str()) {
                let _ = item.set_text(text.as_str().unwrap_or(id));
            }
        }
    }
    Ok(())
}

/// Updates localized labels on application menu items by their IDs.
#[tauri::command]
pub fn update_menu_labels(app: AppHandle, labels: Value) -> Result<(), String> {
    use tauri::menu::MenuItemKind;
    if let Some(menu) = app.menu() {
        if let Some(obj) = labels.as_object() {
            for (id, text) in obj {
                if let Some(item) = menu.get(id) {
                    match item {
                        MenuItemKind::MenuItem(mi) => {
                            let _ = mi.set_text(text.as_str().unwrap_or(id));
                        }
                        MenuItemKind::Submenu(sub) => {
                            let _ = sub.set_text(text.as_str().unwrap_or(id));
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    Ok(())
}

/// Updates the taskbar/dock progress bar (0.0–1.0 for progress, negative to clear).
#[tauri::command]
pub fn update_progress_bar(app: AppHandle, progress: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if progress < 0.0 {
            let _ = window.set_progress_bar(ProgressBarState {
                status: Some(tauri::window::ProgressBarStatus::None),
                progress: None,
            });
        } else {
            let _ = window.set_progress_bar(ProgressBarState {
                status: Some(tauri::window::ProgressBarStatus::Normal),
                progress: Some((progress * 100.0) as u64),
            });
        }
    }
    Ok(())
}

/// Updates the macOS dock badge label (empty string clears the badge).
#[tauri::command]
pub fn update_dock_badge(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("main") {
            if label.is_empty() {
                let _ = window.set_badge_label(None::<String>);
            } else {
                let _ = window.set_badge_label(Some(label));
            }
        }
    }
    let _ = app; // suppress unused warning on non-macOS
    let _ = label;
    Ok(())
}
