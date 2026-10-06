//! Bounded, timestamped local diagnostics. Never record camera packet contents.
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    at_unix_ms: u64,
    pub(crate) message: String,
}

#[derive(Default)]
pub(crate) struct EventLog(Mutex<VecDeque<DiagnosticEvent>>);

impl EventLog {
    pub(crate) fn note(&self, message: impl Into<String>) {
        let mut events = self.0.lock().unwrap();
        if events.len() == 80 {
            events.pop_front();
        }
        events.push_back(DiagnosticEvent {
            at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            message: message.into(),
        });
    }

    pub(crate) fn snapshot(&self) -> Vec<DiagnosticEvent> {
        self.0.lock().unwrap().iter().cloned().collect()
    }
}
