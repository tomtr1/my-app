//! Embedded web apps (WhatsApp Web, Gmail, Outlook, …) as native WebView2 child
//! views laid over a placeholder in the main window. Each app gets its own data
//! directory, so sessions persist across restarts and stay isolated from each
//! other and from the dashboard itself. Child views get no Tauri IPC permissions.

use std::path::PathBuf;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const PREFIX: &str = "miniapp-";

fn safe_id(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid app id".into());
    }
    Ok(id.to_string())
}

fn data_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("miniapps").join(id))
}

#[derive(Clone, serde::Serialize)]
struct TitleEvent {
    id: String,
    title: String,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn miniapp_show(
    app: AppHandle,
    id: String,
    url: String,
    user_agent: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let id = safe_id(&id)?;
    let parsed: url::Url = url.parse().map_err(|_| "invalid url")?;
    if parsed.scheme() != "https" {
        return Err("only https apps can be embedded".into());
    }
    let label = format!("{PREFIX}{id}");
    for (l, wv) in app.webviews() {
        if l.starts_with(PREFIX) && l != label {
            let _ = wv.hide();
        }
    }
    let pos = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));
    if let Some(wv) = app.get_webview(&label) {
        wv.set_position(pos).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("main window missing")?;
    let emitter = app.clone();
    let title_id = id.clone();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .data_directory(data_dir(&app, &id)?)
        .on_document_title_changed(move |_, title| {
            let _ = emitter.emit("miniapp-title", TitleEvent { id: title_id.clone(), title });
        });
    if let Some(ua) = user_agent.as_deref() {
        builder = builder.user_agent(ua);
    }
    window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn miniapp_resize(app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&format!("{PREFIX}{}", safe_id(&id)?)) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn miniapp_hide_all(app: AppHandle) {
    for (l, wv) in app.webviews() {
        if l.starts_with(PREFIX) {
            let _ = wv.hide();
        }
    }
}

#[tauri::command]
pub fn miniapp_reload(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&format!("{PREFIX}{}", safe_id(&id)?)) {
        wv.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Signs out of an app: closes its view and deletes its profile directory.
#[tauri::command]
pub async fn miniapp_clear(app: AppHandle, id: String) -> Result<(), String> {
    let id = safe_id(&id)?;
    if let Some(wv) = app.get_webview(&format!("{PREFIX}{id}")) {
        let _ = wv.clear_all_browsing_data();
        let _ = wv.close();
    }
    let dir = data_dir(&app, &id)?;
    // WebView2 releases its files shortly after the view closes.
    for _ in 0..10 {
        if !dir.exists() || std::fs::remove_dir_all(&dir).is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    Ok(())
}
