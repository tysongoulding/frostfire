#[derive(Debug, Clone)]
pub struct EgressFilter {
    canary_token: String,
    proprietary_fragments: Vec<&'static str>,
}

impl EgressFilter {
    pub fn new(canary: String) -> Self {
        Self {
            canary_token: canary,
            proprietary_fragments: vec![
                "STRICT_INTERNAL_COORDINATOR_RULES",
                "CONFIDENTIAL_PROPRIETARY_PIPELINE",
                "INV:PORTS<=1024->ROOT",
            ],
        }
    }

    pub fn canary_token(&self) -> &str {
        &self.canary_token
    }

    pub fn sanitize_output(&self, response_text: &str) -> Result<String, String> {
        // Check for canary leakage
        if !self.canary_token.is_empty() && response_text.contains(&self.canary_token) {
            return Err("Security Violation: Prompt exfiltration attempt blocked.".to_string());
        }

        // Check for verbatim n-gram / fragment leakage
        for fragment in &self.proprietary_fragments {
            if response_text.contains(fragment) {
                return Err("Security Violation: Proprietary instruction leakage intercepted.".to_string());
            }
        }

        Ok(response_text.to_string())
    }
}
