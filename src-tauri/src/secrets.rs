//! Secrets live in the OS keystore (Windows Credential Manager on Windows).
//! The frontend never sees where they are stored; it only gets values back.

use keyring::Entry;

const SERVICE: &str = "app.lifedash.dashboard";

fn entry(name: &str) -> Result<Entry, String> {
    if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid secret name".into());
    }
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    entry(name)?.set_password(value).map_err(|e| e.to_string())
}

pub fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Names reserved for the Rust side (the Garmin refresh token must never reach JS).
pub fn is_internal(name: &str) -> bool {
    name.starts_with("garmin")
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    if is_internal(&name) {
        return Err("reserved".into());
    }
    get(&name)
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    if is_internal(&name) {
        return Err("reserved".into());
    }
    set(&name, &value)
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    if is_internal(&name) {
        return Err("reserved".into());
    }
    delete(&name)
}
