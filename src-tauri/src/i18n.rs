//! Native-side translations. Reads the very same JSON files as the frontend
//! (compiled into the binary), so there is one source of truth for UI text.

use serde_json::Value;
use std::sync::OnceLock;

static LV: OnceLock<Value> = OnceLock::new();
static EN: OnceLock<Value> = OnceLock::new();

fn dict(lang: &str) -> &'static Value {
    if lang == "en" {
        EN.get_or_init(|| {
            serde_json::from_str(include_str!("../../locales/en.json")).unwrap_or(Value::Null)
        })
    } else {
        LV.get_or_init(|| {
            serde_json::from_str(include_str!("../../locales/lv.json")).unwrap_or(Value::Null)
        })
    }
}

/// Look up a dotted key such as `menu.file`. Falls back to the key itself.
pub fn tr(lang: &str, key: &str) -> String {
    let mut node = dict(lang);
    for part in key.split('.') {
        node = &node[part];
    }
    node.as_str().unwrap_or(key).to_string()
}
