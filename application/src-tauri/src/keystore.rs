use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use zeroize::Zeroizing;

const SERVICE_NAME: &str = "frostfireOS_keystore";

#[derive(Error, Debug)]
pub enum KeystoreError {
    #[error("Keyring entry error: {0}")]
    KeyringError(String),
}

#[derive(Clone)]
pub struct SecureKeystore {
    // In-memory fallback / cache with zeroized strings
    in_memory: Arc<RwLock<HashMap<String, Zeroizing<String>>>>,
}

impl Default for SecureKeystore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecureKeystore {
    pub fn new() -> Self {
        Self {
            in_memory: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Stores secret in OS credential vault (Windows DPAPI / macOS Keychain)
    pub async fn set_secret(&self, key: &str, secret: &str) -> Result<(), KeystoreError> {
        let zeroized = Zeroizing::new(secret.to_string());

        // Attempt keyring storage on desktop platforms
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, key) {
            let _ = entry.set_password(secret);
        }

        // Cache in zeroized in-memory store
        let mut lock = self.in_memory.write().await;
        lock.insert(key.to_string(), zeroized);

        Ok(())
    }

    /// Retrieves secret from OS credential vault or cached zeroized buffer
    pub async fn get_secret(&self, key: &str) -> Result<Option<Zeroizing<String>>, KeystoreError> {
        // Check in-memory zeroized buffer first
        {
            let lock = self.in_memory.read().await;
            if let Some(val) = lock.get(key) {
                return Ok(Some(val.clone()));
            }
        }

        // Attempt retrieval from keyring on desktop platforms
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, key) {
            if let Ok(secret) = entry.get_password() {
                let zeroized = Zeroizing::new(secret);
                let mut lock = self.in_memory.write().await;
                lock.insert(key.to_string(), zeroized.clone());
                return Ok(Some(zeroized));
            }
        }

        Ok(None)
    }

    pub async fn delete_secret(&self, key: &str) -> Result<(), KeystoreError> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, key) {
            let _ = entry.delete_credential();
        }
        let mut lock = self.in_memory.write().await;
        lock.remove(key);
        Ok(())
    }
}
