use serde::{Deserialize, Serialize};
use super::prompts::{DEFAULT_ARCH_PROMPT, DEFAULT_CODE_PROMPT, DEFAULT_COORDINATOR_PROMPT};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PromptMode {
    Defaulted,
    Custom { custom_prompt_text: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PromptConfigDto {
    pub role: String,
    pub is_custom: bool,
    pub display_status: String,
    pub prompt_content: String,
}

pub struct AgentPromptResolver;

impl AgentPromptResolver {
    pub fn resolve_prompt(mode: &PromptMode, role: &str) -> (String, bool) {
        match mode {
            PromptMode::Defaulted => {
                let base_prompt = match role {
                    "arch_sme" => DEFAULT_ARCH_PROMPT,
                    "code_sme" => DEFAULT_CODE_PROMPT,
                    _ => DEFAULT_COORDINATOR_PROMPT,
                };
                // Returns (Prompt, IsProtected)
                (base_prompt.to_string(), true)
            }
            PromptMode::Custom { custom_prompt_text } => {
                // User-defined prompt: no IP protection needed
                (custom_prompt_text.clone(), false)
            }
        }
    }
}
