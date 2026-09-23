use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use hawdb::{Database, DatabaseConfig, value::{Value, ValueRef}};
use napi::{Error, Status};
use napi_derive::napi;

const REVISION: &str = "1e9f76428be6649a18a6f99d75b0ccfef16bf545";
const ABI: &str = "concord-hawdb-1";
const LOCK: &str = "owner.hawdb.lock";
const CREATE_ENTRIES: &str = "CREATE TABLE concord_cache_entries (namespace TEXT NOT NULL, cache_key TEXT NOT NULL, payload BYTEA NOT NULL, sequence BIGINT NOT NULL, PRIMARY KEY (namespace, cache_key))";
const CREATE_SCHEMA: &str = "CREATE TABLE concord_cache_schema (version TEXT NOT NULL PRIMARY KEY)";
const INSERT_SCHEMA: &str = "INSERT INTO concord_cache_schema (version) VALUES ($1)";
const SELECT_SCHEMA: &str = "SELECT version FROM concord_cache_schema LIMIT 2";
const SELECT_NS: &str = "SELECT cache_key, payload, sequence FROM concord_cache_entries WHERE namespace = $1 ORDER BY sequence LIMIT 20001";
const SELECT_ONE: &str = "SELECT payload FROM concord_cache_entries WHERE namespace = $1 AND cache_key = $2 LIMIT 1";
const DELETE_ONE: &str = "DELETE FROM concord_cache_entries WHERE namespace = $1 AND cache_key = $2";
const INSERT_ONE: &str = "INSERT INTO concord_cache_entries (namespace, cache_key, payload, sequence) VALUES ($1, $2, $3, $4)";
const DELETE_NS: &str = "DELETE FROM concord_cache_entries WHERE namespace = $1";
const MIB: usize = 1024 * 1024;

fn err(code: &'static str, reason: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, format!("{code}: {reason}"))
}
fn unavailable(reason: impl std::fmt::Display) -> Error { err("HawdbUnavailable", reason) }
fn limit(reason: impl std::fmt::Display) -> Error { err("HawdbLimit", reason) }
fn unsafe_path(reason: impl std::fmt::Display) -> Error { err("UnsafePath", reason) }
fn engine_open_error(error: impl std::fmt::Display) -> Error {
    let message = error.to_string();
    if message.contains("database directory is already open") { err("HawdbBusy", message) }
    else { unavailable(message) }
}

#[napi(object)]
pub struct CacheEntry { pub key: String, pub payload: String }
#[napi(object)]
pub struct Quota { pub max_entries: u32, pub max_bytes: u32 }
#[napi(object)]
pub struct NativeIdentity { pub revision: String, pub abi: String }
#[napi]
pub fn native_identity() -> NativeIdentity {
    NativeIdentity { revision: REVISION.into(), abi: ABI.into() }
}

#[derive(Clone)]
struct Row { namespace: String, key: String, payload: String, sequence: i64 }
impl Row {
    fn bytes(&self) -> usize { self.namespace.len() + self.key.len() + self.payload.len() }
}
fn namespace_quota(namespace: &str, memory: bool) -> napi::Result<(usize, usize)> {
    match (memory, namespace) {
        (true, "document_parse") | (true, "code_parse") => Ok((10_000, 16*MIB)),
        (true, "git_baseline") => Ok((128, 4*MIB)),
        (false, "annotation_cache") => Ok((64, 24*MIB)),
        (false, "code_cache") => Ok((20_000, 32*MIB)),
        (false, "config_cache") => Ok((128, 8*MIB)),
        (false, "feedback_cache") => Ok((10_000, 32*MIB)),
        _ => Err(err("HawdbIncompatible", "namespace is unavailable in this database mode")),
    }
}
fn namespaces(memory: bool) -> &'static [&'static str] {
    if memory { &["document_parse", "code_parse", "git_baseline"] }
    else { &["annotation_cache", "code_cache", "config_cache", "feedback_cache"] }
}
fn config(read_only: bool) -> DatabaseConfig {
    DatabaseConfig {
        read_only,
        max_read_result_rows: Some(20_000),
        max_read_result_payload_bytes: Some(64*MIB),
        max_wal_replay_entries: Some(100_000),
        max_wal_replay_bytes: Some(128*MIB as u64),
        max_wal_quarantine_bytes: (128*MIB) as u64,
        max_wal_record_bytes: Some(64*MIB),
        max_wal_batch_operations: Some(50_000),
        max_checkpoint_encoded_bytes: Some(256*MIB as u64),
        max_checkpoint_decoded_bytes: Some(512*MIB as u64),
        segment_cache_capacity_bytes: (16*MIB) as u64,
        max_graph_manifest_open_bytes: (8*MIB) as u64,
        max_out_of_core_delta_bytes: Some((16*MIB) as u64),
        ..DatabaseConfig::default()
    }
}
fn inspect_path(path: &Path, create: bool) -> napi::Result<bool> {
    if !path.is_absolute() { return Err(unsafe_path("database path must be absolute")); }
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir => current.push(component.as_os_str()),
            Component::Normal(part) => {
                current.push(part);
                match fs::symlink_metadata(&current) {
                    Ok(metadata) if metadata.file_type().is_symlink() => return Err(unsafe_path("symlink path component")),
                    Ok(metadata) if current == path && !metadata.is_dir() => return Err(unsafe_path("database root is not a directory")),
                    Ok(metadata) if current != path && !metadata.is_dir() => return Err(unsafe_path("parent is not a directory")),
                    Ok(_) => (),
                    Err(error) if error.kind() == io::ErrorKind::NotFound && current == path => {
                        if create { fs::create_dir(&current).map_err(unsafe_path)?; return Ok(true); }
                        return Err(unavailable("database directory is absent"));
                    }
                    Err(error) => return Err(unsafe_path(error)),
                }
            }
            _ => return Err(unsafe_path("noncanonical path component")),
        }
    }
    inspect_tree(path)?;
    Ok(false)
}
fn inspect_tree(path: &Path) -> napi::Result<()> {
    let mut pending = vec![path.to_owned()];
    let mut count = 0_usize;
    let mut bytes = 0_u64;
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(dir).map_err(unsafe_path)? {
            let entry = entry.map_err(unsafe_path)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(unsafe_path)?;
            count += 1;
            if count > 4096 { return Err(limit("database directory entry budget exceeded")); }
            if metadata.file_type().is_symlink() { return Err(unsafe_path("symlink in database directory")); }
            if metadata.is_dir() { pending.push(entry.path()); }
            else if metadata.is_file() {
                if metadata.nlink() != 1 { return Err(unsafe_path("hard link in database directory")); }
                bytes = bytes.saturating_add(metadata.len());
                if bytes > (256*MIB) as u64 { return Err(limit("database directory byte budget exceeded")); }
            } else { return Err(unsafe_path("special file in database directory")); }
        }
    }
    Ok(())
}
fn inspect_lock(path: &Path, create: bool) -> napi::Result<Option<File>> {
    let lock_path = path.join(LOCK);
    match fs::symlink_metadata(&lock_path) {
        Ok(metadata) if !metadata.is_file() || metadata.nlink() != 1 => return Err(unsafe_path("ownership lock must be a regular unique inode")),
        Ok(_) => (),
        Err(error) if error.kind() == io::ErrorKind::NotFound && !create => return Err(unavailable("ownership lock is absent")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(unsafe_path(error)),
    }
    let file = OpenOptions::new().read(true).write(create).create(create).truncate(false)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(&lock_path).map_err(unsafe_path)?;
    let opened = file.metadata().map_err(unsafe_path)?;
    let linked = fs::symlink_metadata(&lock_path).map_err(unsafe_path)?;
    if !opened.is_file() || opened.nlink() != 1 || opened.dev() != linked.dev() || opened.ino() != linked.ino() {
        return Err(unsafe_path("ownership lock inode changed"));
    }
    Ok(Some(file))
}
fn read_rows(db: &Database, namespace: &str) -> napi::Result<Vec<Row>> {
    let output = db.begin_read_transaction().query_sql_with_params_bounded(
        SELECT_NS, &[Value::String(namespace.into())], Some(20_001)).map_err(unavailable)?;
    if output.rows.len() > 20_000 { return Err(limit("query row budget exceeded")); }
    let mut result = Vec::with_capacity(output.rows.len());
    let memory = matches!(namespace, "document_parse" | "code_parse" | "git_baseline");
    let (entry_limit, byte_limit) = namespace_quota(namespace, memory)?;
    if output.rows.len() > entry_limit { return Err(limit("namespace entry budget exceeded")); }
    let mut bytes = 0_usize;
    for row in output.rows.iter() {
        let key = match row.get("cache_key") { Some(Value::String(value)) => value.to_owned(), _ => return Err(err("HawdbIncompatible", "invalid key column")) };
        let payload = match row.get("payload") { Some(Value::Binary(value)) => String::from_utf8(value.to_vec()).map_err(|_| err("HawdbIncompatible", "invalid UTF-8 payload"))?, _ => return Err(err("HawdbIncompatible", "invalid payload column")) };
        let sequence = match row.get("sequence") { Some(Value::Int(value)) => *value, _ => return Err(err("HawdbIncompatible", "invalid sequence column")) };
        let item = Row { namespace: namespace.into(), key, payload, sequence };
        bytes = bytes.saturating_add(item.bytes());
        if bytes > byte_limit || bytes > 64*MIB { return Err(limit("namespace byte budget exceeded")); }
        result.push(item);
    }
    Ok(result)
}
fn all_rows(db: &Database, memory: bool) -> napi::Result<Vec<Row>> {
    let mut rows = Vec::new();
    for namespace in namespaces(memory) { rows.extend(read_rows(db, namespace)?); }
    Ok(rows)
}
fn schema(db: &Database) -> napi::Result<()> {
    let output = db.begin_read_transaction().query_sql_with_params_bounded(SELECT_SCHEMA, &[], Some(2))
        .map_err(|error| err("HawdbIncompatible", error))?;
    if output.rows.len() != 1 { return Err(err("HawdbIncompatible", "cache schema version missing")); }
    match output.rows.get(0, "version") {
        Some(ValueRef::String("1")) => (),
        _ => return Err(err("HawdbIncompatible", "unsupported cache schema")),
    }
    read_rows(db, namespaces(false)[0]).map(|_| ()).or_else(|_| {
        read_rows(db, namespaces(true)[0]).map(|_| ())
    }).map_err(|_| err("HawdbIncompatible", "cache entry table missing"))
}
fn initialize(db: &mut Database) -> napi::Result<()> {
    db.query_sql(CREATE_ENTRIES).map_err(unavailable)?;
    db.query_sql(CREATE_SCHEMA).map_err(unavailable)?;
    db.query_sql_with_params(INSERT_SCHEMA, &[Value::String("1".into())]).map_err(unavailable)?;
    Ok(())
}

struct Handle { db: Option<Database>, path: Option<PathBuf>, memory: bool, read_only: bool, writes: usize, churn: usize, poisoned: bool }
#[napi]
pub struct CacheBridge { handle: Mutex<Handle> }
#[napi]
impl CacheBridge {
    #[napi(constructor)]
    pub fn new(path: String, read_only: bool, create: bool) -> napi::Result<Self> {
        if read_only && create { return Err(err("HawdbIncompatible", "read-only create is invalid")); }
        let path = Path::new(&path);
        let new_dir = inspect_path(path, create)?;
        let manifest_exists = path.join("manifest.hawdb").is_file();
        let lock_exists = path.join(LOCK).exists();
        if !manifest_exists && (read_only || !create || !new_dir && !is_owner_only(path)?) {
            return Err(err("HawdbIncompatible", "existing database is incomplete"));
        }
        if !manifest_exists && lock_exists && read_only { return Err(unavailable("database manifest is absent")); }
        inspect_lock(path, !read_only)?;
        let mut db = Database::open_with_config(path, config(read_only)).map_err(engine_open_error)?;
        if manifest_exists { schema(&db)?; }
        else { initialize(&mut db)?; }
        Ok(Self { handle: Mutex::new(Handle { db: Some(db), path: Some(path.to_owned()), memory: false, read_only, writes: 0, churn: 0, poisoned: false }) })
    }
    #[napi(factory)]
    pub fn memory() -> napi::Result<Self> {
        let mut db = Database::new_with_config(config(false));
        initialize(&mut db)?;
        Ok(Self { handle: Mutex::new(Handle { db: Some(db), path: None, memory: true, read_only: false, writes: 0, churn: 0, poisoned: false }) })
    }
    #[napi]
    pub fn get(&self, namespace: String, keys: Vec<String>) -> napi::Result<Vec<CacheEntry>> {
        let handle = self.handle.lock().map_err(unavailable)?;
        namespace_quota(&namespace, handle.memory)?;
        if keys.len() > 1000 { return Err(limit("get key batch exceeds 1000")); }
        let db = active(&handle)?;
        let mut result = Vec::new();
        let mut bytes = 0_usize;
        for key in keys {
            if key.is_empty() || key.len() > 8*MIB { return Err(limit("invalid key length")); }
            let output = db.begin_read_transaction().query_sql_with_params_bounded(SELECT_ONE,
                &[Value::String(namespace.clone()), Value::String(key.clone())], Some(1)).map_err(unavailable)?;
            if let Some(value) = output.rows.get(0, "payload") {
                let payload = match value { ValueRef::Binary(value) => String::from_utf8(value.to_vec()).map_err(|_| err("HawdbIncompatible", "invalid UTF-8 payload"))?, _ => return Err(err("HawdbIncompatible", "invalid payload column")) };
                bytes += payload.len();
                if bytes > 64*MIB { return Err(limit("get payload budget exceeded")); }
                result.push(CacheEntry { key, payload });
            }
        }
        Ok(result)
    }
    #[napi]
    pub fn scan(&self, namespace: String) -> napi::Result<Vec<CacheEntry>> {
        let handle = self.handle.lock().map_err(unavailable)?;
        namespace_quota(&namespace, handle.memory)?;
        let rows = read_rows(active(&handle)?, &namespace)?;
        Ok(rows.into_iter().map(|row| CacheEntry { key: row.key, payload: row.payload }).collect())
    }
    #[napi]
    pub fn put(&self, namespace: String, entries: Vec<CacheEntry>, quota: Option<Quota>) -> napi::Result<()> {
        let mut handle = self.handle.lock().map_err(unavailable)?;
        let (max_entries, max_bytes) = namespace_quota(&namespace, handle.memory)?;
        if handle.read_only { return Err(err("HawdbIncompatible", "database is read-only")); }
        if entries.len() > 1000 { return Err(limit("write batch exceeds 1000")); }
        let mut input_bytes = 0_usize;
        let mut incoming = BTreeMap::new();
        for (position, entry) in entries.into_iter().enumerate() {
            if entry.key.is_empty() { return Err(limit("empty key")); }
            let size = namespace.len() + entry.key.len() + entry.payload.len();
            if size > 8*MIB { return Err(limit("entry exceeds 8 MiB")); }
            input_bytes = input_bytes.saturating_add(size);
            incoming.insert(entry.key.clone(), (position, entry));
        }
        if input_bytes > 16*MIB { return Err(limit("batch exceeds 16 MiB")); }
        let max_entries = quota.as_ref().map_or(max_entries, |value| max_entries.min(value.max_entries as usize));
        let max_bytes = quota.as_ref().map_or(max_bytes, |value| max_bytes.min(value.max_bytes as usize));
        if max_entries == 0 || max_bytes == 0 { return Err(limit("quota must be positive")); }
        let new_bytes: usize = incoming.values().map(|(_, value)| namespace.len() + value.key.len() + value.payload.len()).sum();
        if incoming.len() > max_entries || new_bytes > max_bytes { return Err(limit("incoming batch exceeds namespace budget")); }
        if incoming.is_empty() { return Ok(()); }
        let memory = handle.memory;
        let db = active_mut(&mut handle)?;
        let mut old = all_rows(db, memory)?;
        let next = old.iter().map(|row| row.sequence).max().unwrap_or(0).checked_add(1).ok_or_else(|| limit("sequence exhausted"))?;
        let mut deletes: HashSet<String> = incoming.keys().cloned().collect();
        let mut remaining: Vec<Row> = old.drain(..).filter(|row| row.namespace == namespace && !deletes.contains(&row.key)).collect();
        remaining.sort_by_key(|row| row.sequence);
        let mut ordered: Vec<_> = incoming.into_values().collect();
        ordered.sort_by_key(|(position, _)| *position);
        let mut additions = Vec::new();
        for (index, (_, entry)) in ordered.into_iter().enumerate() {
            additions.push(Row { namespace: namespace.clone(), key: entry.key, payload: entry.payload, sequence: next.checked_add(index as i64).ok_or_else(|| limit("sequence exhausted"))? });
        }
        let mut count = remaining.len() + additions.len();
        let mut bytes: usize = remaining.iter().chain(additions.iter()).map(Row::bytes).sum();
        let mut evicted = 0;
        while count > max_entries || bytes > max_bytes {
            let row = &remaining[evicted];
            deletes.insert(row.key.clone());
            bytes -= row.bytes(); count -= 1; evicted += 1;
        }
        let mut projected = all_rows(db, memory)?;
        projected.retain(|row| row.namespace != namespace);
        let total: usize = projected.iter().map(Row::bytes).sum::<usize>() + bytes;
        if total > if memory { 36*MIB } else { 96*MIB } { return Err(limit("database logical budget exceeded")); }
        let mut tx = db.begin_transaction();
        for key in deletes {
            tx.query_sql_with_params(DELETE_ONE, &[Value::String(namespace.clone()), Value::String(key)]).map_err(unavailable)?;
        }
        for (index, row) in additions.iter().enumerate() {
            tx.query_sql_with_params(INSERT_ONE, &[Value::String(namespace.clone()), Value::String(row.key.clone()), Value::Binary(row.payload.as_bytes().to_vec()), Value::Int(row.sequence)]).map_err(unavailable)?;
            #[cfg(feature = "test-hooks")]
            if index == 0 { transaction_test_hook()?; }
            #[cfg(not(feature = "test-hooks"))]
            let _ = index;
        }
        tx.commit().map_err(unavailable)?;
        maintain(&mut handle, input_bytes + bytes, additions.len() + evicted)?;
        Ok(())
    }
    #[napi]
    pub fn clear_namespace(&self, namespace: String) -> napi::Result<()> {
        let mut handle = self.handle.lock().map_err(unavailable)?;
        namespace_quota(&namespace, handle.memory)?;
        if handle.read_only { return Err(err("HawdbIncompatible", "database is read-only")); }
        let db = active_mut(&mut handle)?;
        let prior = read_rows(db, &namespace)?;
        db.query_sql_with_params(DELETE_NS, &[Value::String(namespace)]).map_err(unavailable)?;
        let bytes: usize = prior.iter().map(Row::bytes).sum();
        maintain(&mut handle, bytes, prior.len())
    }
    #[napi]
    pub fn namespaces(&self) -> napi::Result<Vec<String>> {
        let handle = self.handle.lock().map_err(unavailable)?;
        let db = active(&handle)?;
        let mut result = Vec::new();
        for name in namespaces(handle.memory) {
            if !read_rows(db, name)?.is_empty() { result.push((*name).into()); }
        }
        Ok(result)
    }
    #[napi]
    pub fn close(&self) -> napi::Result<()> {
        let mut handle = self.handle.lock().map_err(unavailable)?;
        let mut db = handle.db.take();
        let checkpoint = if !handle.memory && !handle.read_only && !handle.poisoned && handle.writes > 0 {
            db.as_mut().map(|db| db.checkpoint()).transpose().map(|_| ()).map_err(unavailable)
        } else { Ok(()) };
        drop(db);
        if checkpoint.is_ok() {
            if let Some(path) = &handle.path { inspect_tree(path)?; }
        }
        checkpoint
    }
}
fn active(handle: &Handle) -> napi::Result<&Database> {
    if handle.poisoned { return Err(unavailable("checkpoint failed; cache handle is unavailable")); }
    handle.db.as_ref().ok_or_else(|| err("HawdbClosed", "cache handle is closed"))
}
fn active_mut(handle: &mut Handle) -> napi::Result<&mut Database> {
    if handle.poisoned { return Err(unavailable("checkpoint failed; cache handle is unavailable")); }
    handle.db.as_mut().ok_or_else(|| err("HawdbClosed", "cache handle is closed"))
}
fn maintain(handle: &mut Handle, bytes: usize, count: usize) -> napi::Result<()> {
    handle.writes += 1;
    handle.churn = handle.churn.saturating_add(bytes.max(count * 64));
    if handle.memory {
        if handle.churn >= 64*MIB || handle.writes >= 2048 {
            let rows = all_rows(active(handle)?, true)?;
            let mut rebuilt = Database::new_with_config(config(false));
            initialize(&mut rebuilt)?;
            let mut tx = rebuilt.begin_transaction();
            for row in rows {
                tx.query_sql_with_params(INSERT_ONE, &[Value::String(row.namespace), Value::String(row.key), Value::Binary(row.payload.into_bytes()), Value::Int(row.sequence)]).map_err(unavailable)?;
            }
            tx.commit().map_err(unavailable)?;
            handle.db = Some(rebuilt);
            handle.churn = 0; handle.writes = 0;
        }
    } else {
        if let Some(path) = &handle.path {
            if let Err(error) = inspect_tree(path) { handle.poisoned = true; return Err(error); }
        }
        if handle.churn < 4*MIB && handle.writes < 32 { return Ok(()); }
        if let Err(error) = active_mut(handle)?.checkpoint() {
            handle.poisoned = true;
            return Err(unavailable(format!("checkpoint failed: {error}")));
        }
        handle.churn = 0; handle.writes = 0;
    }
    Ok(())
}
fn is_owner_only(path: &Path) -> napi::Result<bool> {
    for entry in fs::read_dir(path).map_err(unsafe_path)? {
        if entry.map_err(unsafe_path)?.file_name() != LOCK { return Ok(false); }
    }
    Ok(true)
}

#[napi]
pub struct OwnerGuard { file: Option<File> }
#[napi]
impl OwnerGuard {
    #[napi(constructor)]
    pub fn new(path: String) -> napi::Result<Self> {
        let path = Path::new(&path);
        inspect_path(path, true)?;
        let file = inspect_lock(path, true)?.ok_or_else(|| unavailable("ownership lock unavailable"))?;
        match file.try_lock() {
            Ok(()) => Ok(Self { file: Some(file) }),
            Err(std::fs::TryLockError::WouldBlock) => Err(err("HawdbBusy", "database directory is owned by another handle")),
            Err(std::fs::TryLockError::Error(error)) => Err(unavailable(error)),
        }
    }
    #[napi]
    pub fn close(&mut self) { self.file = None; }
}

#[cfg(feature = "test-hooks")]
fn transaction_test_hook() -> napi::Result<()> {
    if std::env::var_os("CONCORD_HAWDB_TEST_FAIL_AFTER_FIRST").is_some() {
        return Err(unavailable("test injection after first SQL mutation"));
    }
    if let Some(ready) = std::env::var_os("CONCORD_HAWDB_TEST_READY") {
        let ready = PathBuf::from(ready);
        let release = std::env::var_os("CONCORD_HAWDB_TEST_RELEASE").ok_or_else(|| unavailable("missing test release path"))?;
        fs::write(ready, b"ready").map_err(unavailable)?;
        let release = PathBuf::from(release);
        while !release.exists() { std::thread::sleep(std::time::Duration::from_millis(10)); }
    }
    Ok(())
}
