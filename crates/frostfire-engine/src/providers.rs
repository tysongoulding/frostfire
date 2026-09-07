use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    Gemini,
    Anthropic,
    OpenAi,
    Groq,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCredentials {
    pub provider: ProviderType,
    pub api_key: String,
    pub endpoint: Option<String>,
}

pub struct ProviderRegistry {
    pub credentials: Vec<ProviderCredentials>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            credentials: Vec::new(),
        }
    }

    pub fn register(&mut self, creds: ProviderCredentials) {
        self.credentials.retain(|c| c.provider != creds.provider);
        self.credentials.push(creds);
    }

    pub fn get_key(&self, provider: &ProviderType) -> Option<&str> {
        self.credentials
            .iter()
            .find(|c| &c.provider == provider)
            .map(|c| c.api_key.as_str())
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}
