//! Garmin Connect client (Windows build).
//!
//! Garmin's official Health API is partner-only, so this follows the same mobile
//! SSO flow the Garmin Connect app uses (as documented by the open-source
//! python-garminconnect project):
//!
//!   1. POST sso.garmin.com/mobile/api/login            → service ticket (or MFA)
//!   2. POST sso.garmin.com/mobile/api/mfa/verifyCode   → service ticket (MFA only)
//!   3. POST diauth.garmin.com/…/oauth/token            → DI OAuth2 access + refresh token
//!   4. GET  connectapi.garmin.com/…  (Bearer)          → data; refresh_token keeps it alive
//!
//! The password is used once and never stored. Only the refresh token is kept, in
//! Windows Credential Manager, and it never crosses into JavaScript.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

use crate::secrets;

const SSO: &str = "https://sso.garmin.com";
const API: &str = "https://connectapi.garmin.com";
const DI_TOKEN_URL: &str = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const DI_GRANT_TYPE: &str = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";
const IOS_CLIENT_ID: &str = "GCM_IOS_DARK";
const IOS_SERVICE_URL: &str = "https://mobile.integration.garmin.com/gcm/ios";
const IOS_LOGIN_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const DI_CLIENT_IDS: [&str; 4] = [
    "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
    "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
    "GARMIN_CONNECT_MOBILE_ANDROID_DI",
    "GARMIN_CONNECT_MOBILE_IOS_DI",
];
const TOKEN_KEY: &str = "garmin-tokens";

#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    access: String,
    refresh: Option<String>,
    client_id: String,
    display_name: Option<String>,
}

struct PendingMfa {
    client: reqwest::Client,
    method: String,
}

#[derive(Default)]
pub struct GarminState {
    tokens: Mutex<Option<Tokens>>,
    pending: Mutex<Option<PendingMfa>>,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginResult {
    Ok { #[serde(rename = "displayName")] display_name: String },
    MfaRequired,
}

#[derive(Serialize)]
pub struct Status {
    connected: bool,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

fn native_headers(b: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    b.header("User-Agent", "GCM-Android-5.23")
        .header(
            "X-Garmin-User-Agent",
            "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0",
        )
        .header("X-Garmin-Paired-App-Version", "10861")
        .header("X-Garmin-Client-Platform", "Android")
        .header("X-App-Ver", "10861")
        .header("X-Lang", "en")
        .header("X-GCExperience", "GC5")
        .header("Accept-Language", "en-US,en;q=0.9")
}

fn basic(client_id: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("{client_id}:")))
}

/// Reads a claim from an (unverified) JWT payload — only used for expiry/client id hints.
pub(crate) fn jwt_claim(token: &str, claim: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()?.get(claim).cloned()
}

fn expires_soon(token: &str) -> bool {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
    match jwt_claim(token, "exp").and_then(|v| v.as_f64()) {
        Some(exp) if exp.is_finite() => now > exp - 900.0,
        _ => false,
    }
}

fn sso_params() -> [(&'static str, &'static str); 3] {
    [("clientId", IOS_CLIENT_ID), ("locale", "en-US"), ("service", IOS_SERVICE_URL)]
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Interprets the SSO JSON response. Returns Ok(Some(ticket)), Ok(None) for MFA, or an error.
pub(crate) fn interpret_sso(status: u16, body: &Value) -> Result<Option<String>, String> {
    if status == 429 || body.pointer("/error/status-code").and_then(|v| v.as_str()) == Some("429") {
        return Err("Garmin is rate-limiting sign-ins. Wait a few minutes and try again.".into());
    }
    match body.pointer("/responseStatus/type").and_then(|v| v.as_str()) {
        Some("SUCCESSFUL") => body
            .get("serviceTicketId")
            .and_then(|v| v.as_str())
            .map(|t| Some(t.to_string()))
            .ok_or_else(|| "Garmin returned no service ticket".into()),
        Some("MFA_REQUIRED") => Ok(None),
        Some("INVALID_USERNAME_PASSWORD") => Err("Wrong Garmin email or password.".into()),
        Some("CAPTCHA_REQUIRED") => Err("Garmin requires a CAPTCHA right now. Sign in once at connect.garmin.com in your browser, then retry.".into()),
        Some(other) => Err(format!("Garmin sign-in failed ({other}).")),
        None if status == 403 => Err("Garmin blocked the request (HTTP 403). Try again later.".into()),
        None => Err(format!("Unexpected Garmin response (HTTP {status}).")),
    }
}

impl GarminState {
    pub fn load() -> Self {
        let tokens = secrets::get(TOKEN_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok());
        Self { tokens: Mutex::new(tokens), pending: Mutex::new(None) }
    }

    async fn save(&self, t: Option<Tokens>) -> Result<(), String> {
        match &t {
            Some(t) => secrets::set(TOKEN_KEY, &serde_json::to_string(t).map_err(|e| e.to_string())?)?,
            None => secrets::delete(TOKEN_KEY)?,
        }
        *self.tokens.lock().await = t;
        Ok(())
    }

    async fn exchange_ticket(&self, ticket: &str) -> Result<String, String> {
        let client = http()?;
        let mut last = String::from("no client id accepted");
        for client_id in DI_CLIENT_IDS {
            let r = native_headers(client.post(DI_TOKEN_URL))
                .header("Authorization", basic(client_id))
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
                .form(&[
                    ("client_id", client_id),
                    ("service_ticket", ticket),
                    ("grant_type", DI_GRANT_TYPE),
                    ("service_url", IOS_SERVICE_URL),
                ])
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if r.status().as_u16() == 429 {
                return Err("Garmin token exchange rate-limited".into());
            }
            if !r.status().is_success() {
                last = format!("HTTP {}", r.status());
                continue;
            }
            let v: Value = r.json().await.map_err(|e| e.to_string())?;
            let Some(access) = v.get("access_token").and_then(|x| x.as_str()) else { continue };
            let cid = jwt_claim(access, "client_id").and_then(|c| c.as_str().map(String::from)).unwrap_or_else(|| client_id.into());
            let mut t = Tokens {
                access: access.into(),
                refresh: v.get("refresh_token").and_then(|x| x.as_str()).map(String::from),
                client_id: cid,
                display_name: None,
            };
            *self.tokens.lock().await = Some(t.clone());
            let profile: Value = self.get("/userprofile-service/socialProfile").await?;
            let name = profile.get("displayName").and_then(|x| x.as_str()).ok_or("Garmin profile has no display name")?.to_string();
            t.display_name = Some(name.clone());
            self.save(Some(t)).await?;
            return Ok(name);
        }
        Err(format!("Garmin token exchange failed: {last}"))
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginResult, String> {
        let client = http()?;
        let r = client
            .post(format!("{SSO}/mobile/api/login"))
            .query(&sso_params())
            .header("User-Agent", IOS_LOGIN_UA)
            .header("Accept", "application/json, text/plain, */*")
            .header("Origin", SSO)
            .json(&json!({ "username": email, "password": password, "rememberMe": true, "captchaToken": "" }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = r.status().as_u16();
        let body: Value = r.json().await.unwrap_or(Value::Null);
        match interpret_sso(status, &body)? {
            Some(ticket) => Ok(LoginResult::Ok { display_name: self.exchange_ticket(&ticket).await? }),
            None => {
                let method = body.pointer("/customerMfaInfo/mfaLastMethodUsed").and_then(|v| v.as_str()).unwrap_or("email").to_string();
                *self.pending.lock().await = Some(PendingMfa { client, method });
                Ok(LoginResult::MfaRequired)
            }
        }
    }

    pub async fn mfa(&self, code: &str) -> Result<LoginResult, String> {
        let pending = self.pending.lock().await.take().ok_or("No sign-in waiting for a code — start again.")?;
        let r = pending
            .client
            .post(format!("{SSO}/mobile/api/mfa/verifyCode"))
            .query(&sso_params())
            .header("User-Agent", IOS_LOGIN_UA)
            .header("Accept", "application/json, text/plain, */*")
            .header("Origin", SSO)
            .json(&json!({
                "mfaMethod": pending.method,
                "mfaVerificationCode": code.trim(),
                "rememberMyBrowser": true,
                "reconsentList": [],
                "mfaSetup": false
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = r.status().as_u16();
        let body: Value = r.json().await.unwrap_or(Value::Null);
        match interpret_sso(status, &body)? {
            Some(ticket) => Ok(LoginResult::Ok { display_name: self.exchange_ticket(&ticket).await? }),
            None => {
                *self.pending.lock().await = Some(pending);
                Err("Code not accepted — try again.".into())
            }
        }
    }

    async fn refresh(&self) -> Result<(), String> {
        let current = self.tokens.lock().await.clone().ok_or("Garmin not connected")?;
        let refresh = current.refresh.clone().ok_or("Garmin session expired — sign in again")?;
        let r = native_headers(http()?.post(DI_TOKEN_URL))
            .header("Authorization", basic(&current.client_id))
            .header("Accept", "application/json")
            .header("Cache-Control", "no-cache")
            .form(&[("grant_type", "refresh_token"), ("client_id", current.client_id.as_str()), ("refresh_token", refresh.as_str())])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("Garmin token refresh failed (HTTP {}) — sign in again", r.status()));
        }
        let v: Value = r.json().await.map_err(|e| e.to_string())?;
        let access = v.get("access_token").and_then(|x| x.as_str()).ok_or("no access token")?.to_string();
        let t = Tokens {
            client_id: jwt_claim(&access, "client_id").and_then(|c| c.as_str().map(String::from)).unwrap_or(current.client_id),
            refresh: v.get("refresh_token").and_then(|x| x.as_str()).map(String::from).or(current.refresh),
            access,
            display_name: current.display_name,
        };
        self.save(Some(t)).await
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        if !path.starts_with('/') || path.contains("..") || path.contains("://") {
            return Err("invalid path".into());
        }
        for attempt in 0..2 {
            let token = {
                let guard = self.tokens.lock().await;
                guard.as_ref().ok_or("Garmin not connected")?.access.clone()
            };
            if attempt == 0 && expires_soon(&token) {
                self.refresh().await?;
                continue;
            }
            let r = native_headers(http()?.get(format!("{API}{path}")))
                .header("Authorization", format!("Bearer {token}"))
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            match r.status().as_u16() {
                401 if attempt == 0 => {
                    self.refresh().await?;
                    continue;
                }
                204 => return Ok(Value::Null),
                429 => return Err("Garmin rate limit — will retry later".into()),
                s if !(200..300).contains(&s) => return Err(format!("Garmin HTTP {s} on {}", path.split('?').next().unwrap_or(path))),
                _ => {
                    let text = r.text().await.map_err(|e| e.to_string())?;
                    return Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).map_err(|e| e.to_string())? });
                }
            }
        }
        Err("Garmin authentication failed".into())
    }

    pub async fn status(&self) -> Status {
        let t = self.tokens.lock().await;
        Status { connected: t.is_some(), display_name: t.as_ref().and_then(|t| t.display_name.clone()) }
    }

    pub async fn logout(&self) -> Result<(), String> {
        *self.pending.lock().await = None;
        self.save(None).await
    }
}

// ---- commands -----------------------------------------------------------------------------

type St<'a> = tauri::State<'a, GarminState>;

#[tauri::command]
pub async fn garmin_login(state: St<'_>, email: String, password: String) -> Result<LoginResult, String> {
    state.login(&email, &password).await
}

#[tauri::command]
pub async fn garmin_mfa(state: St<'_>, code: String) -> Result<LoginResult, String> {
    state.mfa(&code).await
}

#[tauri::command]
pub async fn garmin_get(state: St<'_>, path: String) -> Result<Value, String> {
    state.get(&path).await
}

#[tauri::command]
pub async fn garmin_status(state: St<'_>) -> Result<Status, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn garmin_logout(state: St<'_>) -> Result<(), String> {
    state.logout().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_jwt_claims() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"client_id":"GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2","exp":4102444800}"#);
        let token = format!("x.{payload}.sig");
        assert_eq!(jwt_claim(&token, "client_id").unwrap(), "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2");
        assert!(!expires_soon(&token));
        let old = format!("x.{}.sig", URL_SAFE_NO_PAD.encode(br#"{"exp":1}"#));
        assert!(expires_soon(&old));
        assert!(!expires_soon("not-a-jwt"));
    }

    #[test]
    fn interprets_sso_responses() {
        assert_eq!(interpret_sso(200, &json!({"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-1"})).unwrap(), Some("ST-1".into()));
        assert_eq!(interpret_sso(200, &json!({"responseStatus":{"type":"MFA_REQUIRED"}})).unwrap(), None);
        assert!(interpret_sso(200, &json!({"responseStatus":{"type":"INVALID_USERNAME_PASSWORD"}})).unwrap_err().contains("Wrong"));
        assert!(interpret_sso(429, &Value::Null).unwrap_err().contains("rate"));
        assert!(interpret_sso(200, &json!({"error":{"status-code":"429"}})).is_err());
    }

    #[test]
    fn basic_auth_has_empty_secret() {
        assert_eq!(basic("abc"), format!("Basic {}", STANDARD.encode("abc:")));
    }
}
