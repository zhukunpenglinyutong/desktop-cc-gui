use super::{EngineCatalog, EngineModel};
use std::sync::Mutex;

/// The CLI's /model menu is only exposed on the ACP session handshake, so
/// the catalog comes from a throwaway `mcode acp` probe (same convention
/// as the qoder catalog): cache the last success so reopening the picker
/// does not re-handshake every time — a provider added to mcode later
/// shows up after an app restart. Probe failure falls back to the static
/// stock list (non-authoritative: anything the user pins still runs).
static CACHE: Mutex<Option<Vec<EngineModel>>> = Mutex::new(None);

pub(super) async fn minimax_catalog(bin: &str) -> EngineCatalog {
    {
        let cached = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(models) = cached.as_ref() {
            return EngineCatalog {
                models: models.clone(),
                authoritative: true,
                remote: false,
            };
        }
    }
    if let Ok(rows) = crate::engine::minimax_acp::probe_models(bin).await {
        if !rows.is_empty() {
            let models = rows
                .into_iter()
                .map(|row| EngineModel {
                    provider: row.id.split('/').next().unwrap_or("minimax").to_string(),
                    id: row.id,
                    name: row.name,
                    description: None,
                    context_window: None,
                })
                .collect::<Vec<_>>();
            if let Ok(mut cached) = CACHE.lock() {
                *cached = Some(models.clone());
            }
            return EngineCatalog {
                models,
                authoritative: true,
                remote: false,
            };
        }
    }
    EngineCatalog {
        models: fallback_catalog(),
        authoritative: false,
        remote: false,
    }
}

/// Stock install menu (verified on a live 0.5.1 handshake), used when the
/// probe cannot run — an uninstalled/broken CLI grays the engine out of
/// the picker anyway, so this mostly covers probe timeouts.
fn fallback_catalog() -> Vec<EngineModel> {
    vec![
        EngineModel {
            id: "minimax/MiniMax-M3".to_string(),
            name: Some("MiniMax-M3".to_string()),
            description: None,
            provider: "minimax".to_string(),
            context_window: None,
        },
        EngineModel {
            id: "minimax/MiniMax-M2.7".to_string(),
            name: Some("MiniMax-M2.7".to_string()),
            description: None,
            provider: "minimax".to_string(),
            context_window: Some(200_000),
        },
        EngineModel {
            id: "minimax/MiniMax-M2.7-highspeed".to_string(),
            name: Some("MiniMax-M2.7-highspeed".to_string()),
            description: None,
            provider: "minimax".to_string(),
            context_window: Some(200_000),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_leads_with_the_newest_model() {
        let models = fallback_catalog();
        assert_eq!(models[0].id, "minimax/MiniMax-M3");
        assert!(models.iter().all(|model| model.id.starts_with("minimax/")));
        assert_eq!(models[1].context_window, Some(200_000));
    }
}
