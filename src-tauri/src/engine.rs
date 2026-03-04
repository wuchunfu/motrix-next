use log;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct EngineState {
    child: Mutex<Option<CommandChild>>,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

pub fn start_engine(app: &tauri::AppHandle, config: &serde_json::Value) -> Result<(), String> {
    let state = app.state::<EngineState>();
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    if child_lock.is_some() {
        return Ok(());
    }

    // Resolve the bundled aria2.conf from the app's resource directory
    let conf_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("binaries")
        .join("aria2.conf");

    let conf_path_str = conf_path.to_string_lossy().to_string();
    log::info!("[aria2c] conf path: {}", conf_path_str);

    let args = build_start_args(config, &conf_path_str);
    log::info!("[aria2c] starting with args: {:?}", args);

    let sidecar = app
        .shell()
        .sidecar("aria2c")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .args(&args);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn aria2c: {}", e))?;

    *child_lock = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[aria2c stdout] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[aria2c stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    log::info!("[aria2c] terminated with code: {:?}", payload.code);
                    if let Some(state) = app_handle.try_state::<EngineState>() {
                        if let Ok(mut child_lock) = state.child.lock() {
                            *child_lock = None;
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

pub fn stop_engine(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<EngineState>();
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    if let Some(child) = child_lock.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill aria2c: {}", e))?;
    }

    Ok(())
}

pub fn restart_engine(app: &tauri::AppHandle, config: &serde_json::Value) -> Result<(), String> {
    stop_engine(app)?;
    start_engine(app, config)
}

fn build_start_args(config: &serde_json::Value, conf_path: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Load the bundled config file (has all BT/DHT/RPC defaults)
    args.push(format!("--conf-path={}", conf_path));

    if let Some(obj) = config.as_object() {
        for (key, value) in obj {
            let val_str = match value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            // Skip keys we force-set below for security
            match key.as_str() {
                "rpc-listen-all" => continue,
                _ => {}
            }
            args.push(format!("--{}={}", key, val_str));
        }
    }

    // Security: only listen on localhost, but allow CORS for Tauri webview
    args.push("--rpc-listen-all=false".to_string());

    args
}
