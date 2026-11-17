//! Apple Intelligence (Foundation Models) bridge.
//!
//! The model is only reachable from Swift, so the work happens in the
//! `CRMIntelligence` Swift package (swift/CRMIntelligence), linked in by
//! build.rs. It exposes one C function taking an operation name and a JSON
//! request and returning a JSON answer. Calls take seconds, so they always run
//! on a blocking worker thread, never on the main thread.

use serde_json::Value;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn crm_ai_call(op: *const c_char, input: *const c_char) -> *mut c_char;
    fn crm_ai_free(pointer: *mut c_char);
}

/// Operations the frontend may run (see CRMIntelligence.swift).
const OPS: &[&str] = &["availability", "probe_cloud", "summarize", "next_step", "extract_contacts"];

fn call(op: &str, input: &Value) -> Result<Value, String> {
    let op = CString::new(op).map_err(|e| e.to_string())?;
    let input = CString::new(input.to_string()).map_err(|e| e.to_string())?;
    // SAFETY: both pointers are valid NUL-terminated strings for the duration of
    // the call; the returned string is owned by Swift and released with crm_ai_free.
    unsafe {
        let out = crm_ai_call(op.as_ptr(), input.as_ptr());
        if out.is_null() {
            return Err("ai_no_answer".into());
        }
        let text = CStr::from_ptr(out).to_string_lossy().into_owned();
        crm_ai_free(out);
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
}

/// Run one Apple Intelligence operation. The answer always has `ok`; failures
/// carry an `error` code the UI translates.
#[tauri::command]
pub async fn ai_call(op: String, input: Value) -> Result<Value, String> {
    if !OPS.contains(&op.as_str()) {
        return Err(format!("unknown op {op}"));
    }
    tauri::async_runtime::spawn_blocking(move || call(&op, &input))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Links the Swift bridge and asks for availability (no model inference).
    #[test]
    fn availability_answers() {
        let out = call("availability", &serde_json::json!({})).expect("bridge call");
        assert_eq!(out["ok"], true, "{out}");
        assert!(out["local"]["available"].is_boolean(), "{out}");
        println!("{out}");
    }

    const TILTS: &str = "Name: Dmitrijs Boreiko\nCompany: Tilts\nStatus: active\nTags: Tiltu Būvniecība un Projektēšana, ieinteresēts\n\nActivities (newest first):\n- 2026-11-17 13:10 call: Called Dmitrijs, he asked to send the BESS offer next week after their internal meeting.\n\nNotes:\nAmats: Head of Energy Department\nInfo par PV: Uzņēmums savā teritorijā Rīgā, Spilves ielā 18, ir īstenojis jau divus saules elektrostaciju (SES) projektus 2024. gadā\nPeļņa 2025: 8 067 824 EUR\n\nAtsauksme:\nDmitrijs stated that the company is able to generate excess energy. The offer sounds interesting. Theoretically, they can manage to accumulate excess energy.";

    /// Latvian UI + cloud allowed but not entitled → must fall back to the local model in English.
    #[test]
    #[ignore]
    fn summarizes_with_cloud_fallback() {
        let out = call("summarize", &serde_json::json!({ "context": TILTS, "lang": "lv", "allow_cloud": true })).expect("bridge call");
        println!("{out:#}");
        assert_eq!(out["ok"], true, "{out}");
        assert_eq!(out["model"], "local");
        assert_eq!(out["language"], "en");
    }

    #[test]
    #[ignore]
    fn suggests_next_step() {
        let out = call("next_step", &serde_json::json!({
            "context": TILTS, "lang": "en", "allow_cloud": false, "today": "Tuesday, 17 November 2026",
            "activity": "call: Called Dmitrijs, he asked to send the BESS offer next week after their internal meeting."
        })).expect("bridge call");
        println!("{out:#}");
        assert_eq!(out["ok"], true, "{out}");
    }

    #[test]
    #[ignore]
    fn probe_cloud_reports_missing_entitlement() {
        let out = call("probe_cloud", &serde_json::json!({})).expect("bridge call");
        println!("{out}");
        assert_eq!(out["ok"], false);
    }

    /// Real on-device generation; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn extracts_people() {
        let text = "Denis Litvinovs\nPurchasing Manager\nd.litvinovs@kekavafoods.lv\n+371 63960776\n\nRomāns Ivanovs\nTechnical Director\nr.ivanovs@kekavafoods.lv\n+371 2947 4526";
        let out = call("extract_contacts", &serde_json::json!({ "text": text })).expect("bridge call");
        println!("{out:#}");
        assert_eq!(out["ok"], true, "{out}");
    }
}
