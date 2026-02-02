pub mod actor;
pub mod proto;
pub mod serial;
pub mod tcp;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Communication state managed by Tauri
#[derive(Default)]
pub struct CommState {
    pub serial: Arc<Mutex<Option<actor::CommActorHandle>>>,
    pub tcp: Arc<Mutex<Option<actor::CommActorHandle>>>,
}
