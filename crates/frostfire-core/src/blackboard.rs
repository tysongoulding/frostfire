use chrono::{DateTime, Utc};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use thiserror::Error;
use tokio::sync::{broadcast, mpsc, oneshot};

#[derive(Error, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlackboardError {
    #[error("Invalid Blackboard URI format: {0}")]
    InvalidUri(String),

    #[error("Write access denied: Author '{caller_id}' cannot write to namespace of '{target_agent_id}'")]
    WriteAccessDenied {
        caller_id: String,
        target_agent_id: String,
    },

    #[error("Unauthorized mutation: Agent '{attempted_by}' attempted to mutate target namespace '{target}'")]
    UnauthorizedMutation {
        attempted_by: String,
        target: String,
    },

    #[error("Namespace '{0}' is frozen (immutable phase lock) and cannot be mutated")]
    FrozenNamespace(String),

    #[error("Artifact not found: {0}")]
    ArtifactNotFound(String),

    #[error("Manifest not found: {0}")]
    ManifestNotFound(String),

    #[error("IO error persisting blackboard: {0}")]
    IoError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),
}

impl From<std::io::Error> for BlackboardError {
    fn from(err: std::io::Error) -> Self {
        BlackboardError::IoError(err.to_string())
    }
}

impl From<rusqlite::Error> for BlackboardError {
    fn from(err: rusqlite::Error) -> Self {
        BlackboardError::DatabaseError(err.to_string())
    }
}

// -----------------------------------------------------------------------------
// Zero-Trust Agent Identity & Access Control (WriteAclGuard)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub agent_id: String,
    pub namespace: String,
    pub is_admin: bool,
}

impl AgentIdentity {
    pub fn new(agent_id: &str, namespace: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            namespace: namespace.to_string(),
            is_admin: false,
        }
    }

    pub fn new_admin(agent_id: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            namespace: "*".to_string(),
            is_admin: true,
        }
    }

    pub fn is_system_admin(&self) -> bool {
        self.is_admin
    }
}

pub struct WriteAclGuard;

impl WriteAclGuard {
    pub fn enforce_mutation(
        caller: &AgentIdentity,
        target_namespace: &str,
        is_frozen: bool,
    ) -> Result<(), BlackboardError> {
        if is_frozen && !caller.is_system_admin() {
            return Err(BlackboardError::FrozenNamespace(target_namespace.to_string()));
        }

        if caller.namespace != target_namespace && !caller.is_system_admin() {
            return Err(BlackboardError::UnauthorizedMutation {
                attempted_by: caller.agent_id.clone(),
                target: target_namespace.to_string(),
            });
        }

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Invariants & Deterministic Verification Engine (Tier 0)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NamespaceInvariants {
    pub produces: Vec<String>,
    pub prohibits: Vec<String>,
    pub assumes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvariantConflict {
    pub rule: String,
    pub producer_namespace: String,
    pub prohibiter_namespace: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissingAssumption {
    pub rule: String,
    pub consumer_namespace: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvariantVerificationResult {
    pub is_valid: bool,
    pub conflicts: Vec<InvariantConflict>,
    pub missing_assumptions: Vec<MissingAssumption>,
}

pub struct DeterministicInvariantEngine;

impl DeterministicInvariantEngine {
    /// Tier 0: Deterministic Invariant Engine (Rust-native static schema & rule check, 0 Tokens).
    /// Compares `produces` vs. `prohibits` across front-matter contracts.
    pub fn verify(manifest: &BlackboardManifest) -> InvariantVerificationResult {
        let mut all_produced: HashMap<String, String> = HashMap::new(); // rule -> producer_ns
        let mut conflicts = Vec::new();
        let mut missing_assumptions = Vec::new();

        // 1. Gather all produces
        for (ns, entry) in &manifest.namespaces {
            for prod in &entry.invariants.produces {
                all_produced.insert(prod.clone(), ns.clone());
            }
        }

        // 2. Check prohibits against produces
        for (ns, entry) in &manifest.namespaces {
            for proh in &entry.invariants.prohibits {
                if let Some(producer) = all_produced.get(proh) {
                    conflicts.push(InvariantConflict {
                        rule: proh.clone(),
                        producer_namespace: producer.clone(),
                        prohibiter_namespace: ns.clone(),
                    });
                }
            }
        }

        // 3. Check assumes against produces
        for (ns, entry) in &manifest.namespaces {
            for assume in &entry.invariants.assumes {
                if !all_produced.contains_key(assume) {
                    missing_assumptions.push(MissingAssumption {
                        rule: assume.clone(),
                        consumer_namespace: ns.clone(),
                    });
                }
            }
        }

        let is_valid = conflicts.is_empty();
        InvariantVerificationResult {
            is_valid,
            conflicts,
            missing_assumptions,
        }
    }
}

// -----------------------------------------------------------------------------
// Dual-Plane Architecture: Data Plane & Presentation Plane
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamespaceEntry {
    pub artifact_uri: String,
    pub author_id: String,
    pub status: String, // "completed", "running", "frozen"
    pub invariants: NamespaceInvariants,
    pub blob_hash: String,
    pub summary: String,
    pub updated_at: DateTime<Utc>,
}

/// Data Plane (Machine Authoritative):
/// Content-addressed JSON manifest retaining URI pointers and invariant metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardManifest {
    pub board_id: String,
    pub version: u64,
    pub namespaces: HashMap<String, NamespaceEntry>,
}

impl BlackboardManifest {
    pub fn new(board_id: &str) -> Self {
        Self {
            board_id: board_id.to_string(),
            version: 1,
            namespaces: HashMap::new(),
        }
    }

    /// Presentation Plane (Human Living Artifact):
    /// Compiles authoritative JSON state into structured Markdown with invisible boundary markers.
    pub fn compile_presentation_markdown(&self) -> String {
        let mut md = format!(
            "# Blackboard Living Presentation Plane: {}\nVersion: {}\n\n",
            self.board_id, self.version
        );

        let mut sorted_keys: Vec<&String> = self.namespaces.keys().collect();
        sorted_keys.sort();

        for ns in sorted_keys {
            if let Some(entry) = self.namespaces.get(ns) {
                md.push_str(&format!(
                    "<!-- BEGIN_NAMESPACE: {} | WRITER: {} -->\n## {}\n- **Status:** {}\n- **Artifact Hash:** sha256:{}\n### Implementation\n{}\n<!-- END_NAMESPACE: {} -->\n\n",
                    ns, entry.author_id, ns, entry.status, entry.blob_hash, entry.summary, ns
                ));
            }
        }

        md
    }
}

// -----------------------------------------------------------------------------
// URI & Artifact Data Structures
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ArtifactUri {
    pub workstream_id: String,
    pub team_id: String,
    pub agent_id: String,
    pub artifact_name: String,
    pub version: u32,
}

impl ArtifactUri {
    pub fn parse(input: &str) -> Result<Self, BlackboardError> {
        let re = Regex::new(
            r"^blackboard://(?P<ws>[a-zA-Z0-9_\-]+)/(?P<team>[a-zA-Z0-9_\-]+)/(?P<agent>[a-zA-Z0-9_\-]+)/(?P<artifact>[a-zA-Z0-9_\-]+)@v(?P<version>\d+)$"
        ).unwrap();

        let caps = re
            .captures(input)
            .ok_or_else(|| BlackboardError::InvalidUri(input.to_string()))?;

        let version = caps["version"]
            .parse::<u32>()
            .map_err(|_| BlackboardError::InvalidUri(input.to_string()))?;

        Ok(Self {
            workstream_id: caps["ws"].to_string(),
            team_id: caps["team"].to_string(),
            agent_id: caps["agent"].to_string(),
            artifact_name: caps["artifact"].to_string(),
            version,
        })
    }

    pub fn base_key(&self) -> String {
        format!(
            "{}/{}/{}/{}",
            self.workstream_id, self.team_id, self.agent_id, self.artifact_name
        )
    }
}

impl std::fmt::Display for ArtifactUri {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "blackboard://{}/{}/{}/{}@v{}",
            self.workstream_id, self.team_id, self.agent_id, self.artifact_name, self.version
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardArtifact {
    pub uri: String,
    pub author_id: String,
    pub title: String,
    pub content: String,
    pub mime_type: String,
    pub version: u32,
    pub hash: String,
    pub created_at: DateTime<Utc>,
}

impl BlackboardArtifact {
    pub fn new(
        uri_str: &str,
        author_id: &str,
        title: &str,
        content: &str,
        mime_type: &str,
    ) -> Result<Self, BlackboardError> {
        let uri = ArtifactUri::parse(uri_str)?;
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = hex::encode(hasher.finalize());

        Ok(Self {
            uri: uri.to_string(),
            author_id: author_id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            mime_type: mime_type.to_string(),
            version: uri.version,
            hash,
            created_at: Utc::now(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardSignal {
    pub uri: String,
    pub author_id: String,
    pub title: String,
    pub version: u32,
    pub content_hash: String,
    pub size_bytes: usize,
    pub created_at: DateTime<Utc>,
}

// -----------------------------------------------------------------------------
// SQLite Substrate, Schema & Single-Writer Actor Channel (ADR-0004, 0008, 0010)
// -----------------------------------------------------------------------------

enum WriteCommand {
    PublishArtifact {
        caller_agent_id: String,
        artifact: BlackboardArtifact,
        resp: oneshot::Sender<Result<BlackboardSignal, BlackboardError>>,
    },
    UpdateManifest {
        caller: AgentIdentity,
        board_id: String,
        target_namespace: String,
        entry: NamespaceEntry,
        resp: oneshot::Sender<Result<(), BlackboardError>>,
    },
    FreezeNamespace {
        namespace: String,
        resp: oneshot::Sender<Result<(), BlackboardError>>,
    },
}

fn init_sqlite_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;

         CREATE TABLE IF NOT EXISTS artifacts (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             uri TEXT NOT NULL UNIQUE,
             workstream_id TEXT NOT NULL,
             team_id TEXT NOT NULL,
             agent_id TEXT NOT NULL,
             artifact_name TEXT NOT NULL,
             version INTEGER NOT NULL,
             author_id TEXT NOT NULL,
             title TEXT NOT NULL,
             mime_type TEXT NOT NULL,
             content TEXT,
             hash TEXT NOT NULL,
             size_bytes INTEGER NOT NULL,
             is_blob INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL
         );

         CREATE INDEX IF NOT EXISTS idx_artifacts_lookup 
         ON artifacts(workstream_id, team_id, agent_id, artifact_name, version);

         CREATE INDEX IF NOT EXISTS idx_artifacts_workstream 
         ON artifacts(workstream_id);

         CREATE TABLE IF NOT EXISTS manifests (
             board_id TEXT PRIMARY KEY,
             version INTEGER NOT NULL,
             manifest_json TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS frozen_namespaces (
             namespace TEXT PRIMARY KEY,
             frozen_at TEXT NOT NULL
         );",
    )?;
    Ok(())
}

fn spawn_writer_actor(
    mut writer_conn: Connection,
    mut rx: mpsc::Receiver<WriteCommand>,
    signal_sender: broadcast::Sender<BlackboardSignal>,
    blobs_dir: Option<PathBuf>,
    in_memory_blobs: Arc<RwLock<HashMap<String, String>>>,
) {
    std::thread::Builder::new()
        .name("frostfire-blackboard-writer".to_string())
        .spawn(move || {
            while let Some(cmd) = rx.blocking_recv() {
                match cmd {
                    WriteCommand::PublishArtifact {
                        caller_agent_id,
                        artifact,
                        resp,
                    } => {
                        let res = handle_publish_artifact(
                            &mut writer_conn,
                            &caller_agent_id,
                            artifact,
                            &blobs_dir,
                            &in_memory_blobs,
                            &signal_sender,
                        );
                        let _ = resp.send(res);
                    }
                    WriteCommand::UpdateManifest {
                        caller,
                        board_id,
                        target_namespace,
                        entry,
                        resp,
                    } => {
                        let res = handle_update_manifest(
                            &mut writer_conn,
                            &caller,
                            &board_id,
                            &target_namespace,
                            entry,
                        );
                        let _ = resp.send(res);
                    }
                    WriteCommand::FreezeNamespace { namespace, resp } => {
                        let res = handle_freeze_namespace(&mut writer_conn, &namespace);
                        let _ = resp.send(res);
                    }
                }
            }
        })
        .expect("Failed to spawn blackboard writer actor thread");
}

fn handle_publish_artifact(
    conn: &mut Connection,
    caller_agent_id: &str,
    artifact: BlackboardArtifact,
    blobs_dir: &Option<PathBuf>,
    in_memory_blobs: &Arc<RwLock<HashMap<String, String>>>,
    signal_sender: &broadcast::Sender<BlackboardSignal>,
) -> Result<BlackboardSignal, BlackboardError> {
    let uri = ArtifactUri::parse(&artifact.uri)?;

    if caller_agent_id != uri.agent_id || artifact.author_id != uri.agent_id {
        return Err(BlackboardError::WriteAccessDenied {
            caller_id: caller_agent_id.to_string(),
            target_agent_id: uri.agent_id.clone(),
        });
    }

    let is_frozen = conn
        .query_row(
            "SELECT 1 FROM frozen_namespaces WHERE namespace = ?1",
            params![&uri.agent_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    if is_frozen {
        return Err(BlackboardError::FrozenNamespace(uri.agent_id.clone()));
    }

    // Hybrid Storage (ADR-0008): Write >1MB payloads to blobs dir or in-memory map
    let is_blob = if artifact.content.len() > 1_000_000 {
        if let Some(ref bdir) = blobs_dir {
            let blob_path = bdir.join(format!("{}.bin", artifact.hash));
            std::fs::write(blob_path, &artifact.content)?;
        } else {
            let mut map = in_memory_blobs.write().unwrap();
            map.insert(artifact.hash.clone(), artifact.content.clone());
        }
        1
    } else {
        0
    };

    let content_to_store: Option<&str> = if is_blob == 1 {
        None
    } else {
        Some(&artifact.content)
    };

    let created_at_str = artifact.created_at.to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO artifacts (
            uri, workstream_id, team_id, agent_id, artifact_name, version,
            author_id, title, mime_type, content, hash, size_bytes, is_blob, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            &artifact.uri,
            &uri.workstream_id,
            &uri.team_id,
            &uri.agent_id,
            &uri.artifact_name,
            uri.version,
            &artifact.author_id,
            &artifact.title,
            &artifact.mime_type,
            content_to_store,
            &artifact.hash,
            artifact.content.len() as i64,
            is_blob,
            &created_at_str,
        ],
    )?;

    let signal = BlackboardSignal {
        uri: artifact.uri.clone(),
        author_id: artifact.author_id.clone(),
        title: artifact.title.clone(),
        version: artifact.version,
        content_hash: artifact.hash.clone(),
        size_bytes: artifact.content.len(),
        created_at: artifact.created_at,
    };

    let _ = signal_sender.send(signal.clone());
    Ok(signal)
}

fn handle_update_manifest(
    conn: &mut Connection,
    caller: &AgentIdentity,
    board_id: &str,
    target_namespace: &str,
    entry: NamespaceEntry,
) -> Result<(), BlackboardError> {
    let is_frozen = conn
        .query_row(
            "SELECT 1 FROM frozen_namespaces WHERE namespace = ?1",
            params![target_namespace],
            |_| Ok(()),
        )
        .optional()?
        .is_some();

    WriteAclGuard::enforce_mutation(caller, target_namespace, is_frozen)?;

    let existing: Option<String> = conn
        .query_row(
            "SELECT manifest_json FROM manifests WHERE board_id = ?1",
            params![board_id],
            |row| row.get(0),
        )
        .optional()?;

    let mut manifest = match existing {
        Some(json_str) => serde_json::from_str::<BlackboardManifest>(&json_str)
            .unwrap_or_else(|_| BlackboardManifest::new(board_id)),
        None => BlackboardManifest::new(board_id),
    };

    manifest.version += 1;
    manifest.namespaces.insert(target_namespace.to_string(), entry);
    let updated_json =
        serde_json::to_string(&manifest).map_err(|e| BlackboardError::IoError(e.to_string()))?;
    let updated_at_str = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO manifests (board_id, version, manifest_json, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![board_id, manifest.version as i64, updated_json, updated_at_str],
    )?;

    Ok(())
}

fn handle_freeze_namespace(conn: &mut Connection, namespace: &str) -> Result<(), BlackboardError> {
    let frozen_at_str = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO frozen_namespaces (namespace, frozen_at) VALUES (?1, ?2)",
        params![namespace, frozen_at_str],
    )?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Unified Blackboard Store
// -----------------------------------------------------------------------------

pub struct BlackboardStore {
    write_tx: mpsc::Sender<WriteCommand>,
    reader_conn: Arc<Mutex<Connection>>,
    disk_path: Option<PathBuf>,
    blobs_dir: Option<PathBuf>,
    in_memory_blobs: Arc<RwLock<HashMap<String, String>>>,
    signal_sender: broadcast::Sender<BlackboardSignal>,
}

impl BlackboardStore {
    pub fn new_in_memory() -> Self {
        let mem_id = uuid::Uuid::new_v4().simple().to_string();
        let uri = format!("file:frostfire_mem_{}?mode=memory&cache=shared", mem_id);

        let writer_conn =
            Connection::open(&uri).expect("Failed to open SQLite memory writer connection");
        init_sqlite_schema(&writer_conn).expect("Failed to init SQLite schema");

        let reader_conn =
            Connection::open(&uri).expect("Failed to open SQLite memory reader connection");

        let (signal_sender, _) = broadcast::channel(512);
        let (write_tx, rx) = mpsc::channel(1024);
        let in_memory_blobs = Arc::new(RwLock::new(HashMap::new()));

        spawn_writer_actor(
            writer_conn,
            rx,
            signal_sender.clone(),
            None,
            in_memory_blobs.clone(),
        );

        Self {
            write_tx,
            reader_conn: Arc::new(Mutex::new(reader_conn)),
            disk_path: None,
            blobs_dir: None,
            in_memory_blobs,
            signal_sender,
        }
    }

    pub fn new_with_persistence(disk_path: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&disk_path);
        let blobs_dir = disk_path.join("blobs");
        let _ = std::fs::create_dir_all(&blobs_dir);
        let db_path = disk_path.join("blackboard.db");

        let writer_conn =
            Connection::open(&db_path).expect("Failed to open SQLite writer connection");
        init_sqlite_schema(&writer_conn).expect("Failed to init SQLite schema");

        let reader_conn =
            Connection::open(&db_path).expect("Failed to open SQLite reader connection");

        let (signal_sender, _) = broadcast::channel(512);
        let (write_tx, rx) = mpsc::channel(1024);
        let in_memory_blobs = Arc::new(RwLock::new(HashMap::new()));

        spawn_writer_actor(
            writer_conn,
            rx,
            signal_sender.clone(),
            Some(blobs_dir.clone()),
            in_memory_blobs.clone(),
        );

        Self {
            write_tx,
            reader_conn: Arc::new(Mutex::new(reader_conn)),
            disk_path: Some(disk_path),
            blobs_dir: Some(blobs_dir),
            in_memory_blobs,
            signal_sender,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BlackboardSignal> {
        self.signal_sender.subscribe()
    }

    pub fn disk_path(&self) -> Option<&PathBuf> {
        self.disk_path.as_ref()
    }

    /// Zero-Trust Author Write Isolation:
    /// An agent can ONLY write to their own namespace `blackboard://{ws}/{team}/{agent}/...`.
    pub async fn publish(
        &self,
        caller_agent_id: &str,
        artifact: BlackboardArtifact,
    ) -> Result<BlackboardSignal, BlackboardError> {
        let uri = ArtifactUri::parse(&artifact.uri)?;

        if caller_agent_id != uri.agent_id || artifact.author_id != uri.agent_id {
            return Err(BlackboardError::WriteAccessDenied {
                caller_id: caller_agent_id.to_string(),
                target_agent_id: uri.agent_id.clone(),
            });
        }

        let (resp_tx, resp_rx) = oneshot::channel();
        self.write_tx
            .send(WriteCommand::PublishArtifact {
                caller_agent_id: caller_agent_id.to_string(),
                artifact,
                resp: resp_tx,
            })
            .await
            .map_err(|_| BlackboardError::DatabaseError("Write actor channel closed".to_string()))?;

        resp_rx
            .await
            .map_err(|_| BlackboardError::DatabaseError("Write actor dropped response".to_string()))?
    }

    /// Update or insert a namespace entry into the Data Plane manifest under Zero-Trust ACLs.
    pub async fn update_manifest_namespace(
        &self,
        caller: &AgentIdentity,
        board_id: &str,
        target_namespace: &str,
        entry: NamespaceEntry,
    ) -> Result<(), BlackboardError> {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.write_tx
            .send(WriteCommand::UpdateManifest {
                caller: caller.clone(),
                board_id: board_id.to_string(),
                target_namespace: target_namespace.to_string(),
                entry,
                resp: resp_tx,
            })
            .await
            .map_err(|_| BlackboardError::DatabaseError("Write actor channel closed".to_string()))?;

        resp_rx
            .await
            .map_err(|_| BlackboardError::DatabaseError("Write actor dropped response".to_string()))?
    }

    /// Freeze a namespace when an execution phase completes (making it immutable).
    pub async fn freeze_namespace(&self, namespace: &str) {
        let (resp_tx, resp_rx) = oneshot::channel();
        if self
            .write_tx
            .send(WriteCommand::FreezeNamespace {
                namespace: namespace.to_string(),
                resp: resp_tx,
            })
            .await
            .is_ok()
        {
            let _ = resp_rx.await;
        }
    }

    pub async fn get_manifest(&self, board_id: &str) -> Result<BlackboardManifest, BlackboardError> {
        let json_opt: Option<String> = {
            let conn = self.reader_conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT manifest_json FROM manifests WHERE board_id = ?1")?;
            stmt.query_row(params![board_id], |row| row.get(0)).optional()?
        };

        match json_opt {
            Some(json_str) => {
                serde_json::from_str(&json_str).map_err(|e| BlackboardError::IoError(e.to_string()))
            }
            None => Err(BlackboardError::ManifestNotFound(board_id.to_string())),
        }
    }

    pub async fn get_presentation_markdown(&self, board_id: &str) -> Result<String, BlackboardError> {
        let manifest = self.get_manifest(board_id).await?;
        Ok(manifest.compile_presentation_markdown())
    }

    pub async fn verify_manifest_invariants(
        &self,
        board_id: &str,
    ) -> Result<InvariantVerificationResult, BlackboardError> {
        let manifest = self.get_manifest(board_id).await?;
        Ok(DeterministicInvariantEngine::verify(&manifest))
    }

    pub async fn get(&self, uri_str: &str) -> Result<BlackboardArtifact, BlackboardError> {
        let _uri = ArtifactUri::parse(uri_str)?;
        let opt = {
            let conn = self.reader_conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT uri, author_id, title, content, mime_type, version, hash, is_blob, created_at 
                 FROM artifacts WHERE uri = ?1",
            )?;
            stmt.query_row(params![uri_str], |row| {
                let uri: String = row.get(0)?;
                let author_id: String = row.get(1)?;
                let title: String = row.get(2)?;
                let content_opt: Option<String> = row.get(3)?;
                let mime_type: String = row.get(4)?;
                let version: u32 = row.get(5)?;
                let hash: String = row.get(6)?;
                let is_blob: i32 = row.get(7)?;
                let created_at_str: String = row.get(8)?;
                Ok((
                    uri,
                    author_id,
                    title,
                    content_opt,
                    mime_type,
                    version,
                    hash,
                    is_blob,
                    created_at_str,
                ))
            })
            .optional()?
        };

        let (uri, author_id, title, content_opt, mime_type, version, hash, is_blob, created_at_str) =
            match opt {
                Some(val) => val,
                None => return Err(BlackboardError::ArtifactNotFound(uri_str.to_string())),
            };

        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let content = if is_blob == 1 {
            if let Some(ref bdir) = self.blobs_dir {
                let blob_path = bdir.join(format!("{}.bin", hash));
                tokio::fs::read_to_string(blob_path).await?
            } else {
                let map = self.in_memory_blobs.read().unwrap();
                map.get(&hash).cloned().unwrap_or_default()
            }
        } else {
            content_opt.unwrap_or_default()
        };

        Ok(BlackboardArtifact {
            uri,
            author_id,
            title,
            content,
            mime_type,
            version,
            hash,
            created_at,
        })
    }

    pub async fn get_latest(
        &self,
        workstream_id: &str,
        team_id: &str,
        agent_id: &str,
        artifact_name: &str,
    ) -> Result<BlackboardArtifact, BlackboardError> {
        let opt = {
            let conn = self.reader_conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT uri, author_id, title, content, mime_type, version, hash, is_blob, created_at 
                 FROM artifacts 
                 WHERE workstream_id = ?1 AND team_id = ?2 AND agent_id = ?3 AND artifact_name = ?4 
                 ORDER BY version DESC LIMIT 1",
            )?;
            stmt.query_row(
                params![workstream_id, team_id, agent_id, artifact_name],
                |row| {
                    let uri: String = row.get(0)?;
                    let author_id: String = row.get(1)?;
                    let title: String = row.get(2)?;
                    let content_opt: Option<String> = row.get(3)?;
                    let mime_type: String = row.get(4)?;
                    let version: u32 = row.get(5)?;
                    let hash: String = row.get(6)?;
                    let is_blob: i32 = row.get(7)?;
                    let created_at_str: String = row.get(8)?;
                    Ok((
                        uri,
                        author_id,
                        title,
                        content_opt,
                        mime_type,
                        version,
                        hash,
                        is_blob,
                        created_at_str,
                    ))
                },
            )
            .optional()?
        };

        let (uri, author_id, title, content_opt, mime_type, version, hash, is_blob, created_at_str) =
            match opt {
                Some(val) => val,
                None => {
                    return Err(BlackboardError::ArtifactNotFound(format!(
                        "blackboard://{}/{}/{}/{}@latest",
                        workstream_id, team_id, agent_id, artifact_name
                    )))
                }
            };

        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let content = if is_blob == 1 {
            if let Some(ref bdir) = self.blobs_dir {
                let blob_path = bdir.join(format!("{}.bin", hash));
                tokio::fs::read_to_string(blob_path).await?
            } else {
                let map = self.in_memory_blobs.read().unwrap();
                map.get(&hash).cloned().unwrap_or_default()
            }
        } else {
            content_opt.unwrap_or_default()
        };

        Ok(BlackboardArtifact {
            uri,
            author_id,
            title,
            content,
            mime_type,
            version,
            hash,
            created_at,
        })
    }

    pub async fn list_by_workstream(&self, workstream_id: &str) -> Vec<BlackboardArtifact> {
        let items = {
            let conn = self.reader_conn.lock().unwrap();
            let mut stmt = match conn.prepare(
                "SELECT a.uri, a.author_id, a.title, a.content, a.mime_type, a.version, a.hash, a.is_blob, a.created_at
                 FROM artifacts a
                 INNER JOIN (
                     SELECT workstream_id, team_id, agent_id, artifact_name, MAX(version) AS max_v
                     FROM artifacts
                     WHERE workstream_id = ?1
                     GROUP BY workstream_id, team_id, agent_id, artifact_name
                 ) latest ON a.workstream_id = latest.workstream_id 
                         AND a.team_id = latest.team_id 
                         AND a.agent_id = latest.agent_id 
                         AND a.artifact_name = latest.artifact_name 
                         AND a.version = latest.max_v
                 ORDER BY a.id ASC",
            ) {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };

            let rows = match stmt.query_map(params![workstream_id], |row| {
                let uri: String = row.get(0)?;
                let author_id: String = row.get(1)?;
                let title: String = row.get(2)?;
                let content_opt: Option<String> = row.get(3)?;
                let mime_type: String = row.get(4)?;
                let version: u32 = row.get(5)?;
                let hash: String = row.get(6)?;
                let is_blob: i32 = row.get(7)?;
                let created_at_str: String = row.get(8)?;
                Ok((
                    uri,
                    author_id,
                    title,
                    content_opt,
                    mime_type,
                    version,
                    hash,
                    is_blob,
                    created_at_str,
                ))
            }) {
                Ok(mapped) => mapped,
                Err(_) => return Vec::new(),
            };

            rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
        };

        let mut list = Vec::new();
        for (uri, author_id, title, content_opt, mime_type, version, hash, is_blob, created_at_str) in
            items
        {
            let created_at = DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let content = if is_blob == 1 {
                if let Some(ref bdir) = self.blobs_dir {
                    let blob_path = bdir.join(format!("{}.bin", hash));
                    tokio::fs::read_to_string(blob_path).await.unwrap_or_default()
                } else {
                    let map = self.in_memory_blobs.read().unwrap();
                    map.get(&hash).cloned().unwrap_or_default()
                }
            } else {
                content_opt.unwrap_or_default()
            };
            list.push(BlackboardArtifact {
                uri,
                author_id,
                title,
                content,
                mime_type,
                version,
                hash,
                created_at,
            });
        }
        list
    }
}
