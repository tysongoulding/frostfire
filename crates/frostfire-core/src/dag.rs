use crate::blackboard::NamespaceInvariants;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum DagError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Team branch not found: {0}")]
    TeamNotFound(String),

    #[error("Cycle detected in Workstream DAG dependencies")]
    CycleDetected,

    #[error("Invalid front-matter or promotion manifest: {0}")]
    InvalidManifest(String),

    #[error("Convergence barrier not satisfied: Outstanding unfinalized teams: {0:?}")]
    BarrierNotMet(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub title: String,
    pub agent_id: String,
    pub status: TaskStatus,
    pub input_uris: Vec<String>,
    pub output_uris: Vec<String>,
}

impl TaskNode {
    pub fn new(id: &str, title: &str, agent_id: &str) -> Self {
        Self {
            id: id.to_string(),
            title: title.to_string(),
            agent_id: agent_id.to_string(),
            status: TaskStatus::Pending,
            input_uris: Vec::new(),
            output_uris: Vec::new(),
        }
    }
}

// -----------------------------------------------------------------------------
// Intra-Team Micro-DAG
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkstreamDag {
    pub id: String,
    pub nodes: HashMap<String, TaskNode>,
    // node_id -> set of dependencies that must finish first
    pub dependencies: HashMap<String, HashSet<String>>,
}

impl WorkstreamDag {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            nodes: HashMap::new(),
            dependencies: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node: TaskNode) {
        self.dependencies.entry(node.id.clone()).or_default();
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn add_dependency(&mut self, task_id: &str, depends_on_id: &str) -> Result<(), DagError> {
        if !self.nodes.contains_key(task_id) {
            return Err(DagError::TaskNotFound(task_id.to_string()));
        }
        if !self.nodes.contains_key(depends_on_id) {
            return Err(DagError::TaskNotFound(depends_on_id.to_string()));
        }

        self.dependencies
            .entry(task_id.to_string())
            .or_default()
            .insert(depends_on_id.to_string());

        Ok(())
    }

    /// Kahn's algorithm for topological sorting and cycle detection
    pub fn topological_sort(&self) -> Result<Vec<String>, DagError> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();

        for node_id in self.nodes.keys() {
            in_degree.insert(node_id.clone(), 0);
            dependents.insert(node_id.clone(), Vec::new());
        }

        for (node_id, deps) in &self.dependencies {
            in_degree.insert(node_id.clone(), deps.len());
            for dep in deps {
                dependents.entry(dep.clone()).or_default().push(node_id.clone());
            }
        }

        let mut queue: VecDeque<String> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(id, _)| id.clone())
            .collect();

        let mut order = Vec::new();

        while let Some(node_id) = queue.pop_front() {
            order.push(node_id.clone());

            if let Some(downstream) = dependents.get(&node_id) {
                for next_id in downstream {
                    if let Some(deg) = in_degree.get_mut(next_id) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push_back(next_id.clone());
                        }
                    }
                }
            }
        }

        if order.len() != self.nodes.len() {
            return Err(DagError::CycleDetected);
        }

        Ok(order)
    }

    pub fn get_ready_tasks(&self, completed_tasks: &HashSet<String>) -> Vec<String> {
        let mut ready = Vec::new();
        for (node_id, node) in &self.nodes {
            if node.status != TaskStatus::Pending {
                continue;
            }
            let deps = self.dependencies.get(node_id);
            let all_met = match deps {
                Some(deps) => deps.iter().all(|d| completed_tasks.contains(d)),
                None => true,
            };
            if all_met {
                ready.push(node_id.clone());
            }
        }
        ready
    }
}

// -----------------------------------------------------------------------------
// Dumb Coordinator Node: Lightweight Deterministic Parser
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromotionManifest {
    pub team_id: String,
    pub artifact_uri: String,
    pub status: String,
    pub blob_hash: String,
    pub invariants: NamespaceInvariants,
}

pub struct DumbCoordinatorNode;

impl DumbCoordinatorNode {
    /// Deterministically parses front-matter URI pointers and promotion statuses
    /// without invoking expensive or nondeterministic LLM inference.
    pub fn parse_frontmatter_manifest(content: &str) -> Result<PromotionManifest, DagError> {
        let uri_re = Regex::new(r"(?m)^artifact_uri:\s*([^\s]+)").unwrap();
        let team_re = Regex::new(r"(?m)^team_id:\s*([^\s]+)").unwrap();
        let status_re = Regex::new(r"(?m)^status:\s*([^\s]+)").unwrap();
        let hash_re = Regex::new(r"(?m)^blob_hash:\s*([^\s]+)").unwrap();

        let artifact_uri = uri_re
            .captures(content)
            .map(|c| c[1].to_string())
            .ok_or_else(|| DagError::InvalidManifest("Missing 'artifact_uri'".to_string()))?;

        let team_id = team_re
            .captures(content)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| "default_team".to_string());

        let status = status_re
            .captures(content)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| "completed".to_string());

        let blob_hash = hash_re
            .captures(content)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| "none".to_string());

        // Parse optional produces/prohibits/assumes
        let prod_re = Regex::new(r"(?m)^produces:\s*\[(.*?)\]").unwrap();
        let proh_re = Regex::new(r"(?m)^prohibits:\s*\[(.*?)\]").unwrap();
        let assu_re = Regex::new(r"(?m)^assumes:\s*\[(.*?)\]").unwrap();

        let parse_list = |re: &Regex| -> Vec<String> {
            re.captures(content)
                .map(|c| {
                    c[1].split(',')
                        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default()
        };

        let invariants = NamespaceInvariants {
            produces: parse_list(&prod_re),
            prohibits: parse_list(&proh_re),
            assumes: parse_list(&assu_re),
        };

        Ok(PromotionManifest {
            team_id,
            artifact_uri,
            status,
            blob_hash,
            invariants,
        })
    }
}

// -----------------------------------------------------------------------------
// Hybrid Split-and-Merge DAG Architecture
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamExecutionBranch {
    pub team_id: String,
    pub micro_dag: WorkstreamDag,
    pub is_finalized: bool,
    pub promotion_manifest: Option<PromotionManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSplitMergeDag {
    pub federation_id: String,
    pub teams: HashMap<String, TeamExecutionBranch>,
}

impl HybridSplitMergeDag {
    pub fn new(federation_id: &str) -> Self {
        Self {
            federation_id: federation_id.to_string(),
            teams: HashMap::new(),
        }
    }

    pub fn add_team_branch(&mut self, team_id: &str, micro_dag: WorkstreamDag) {
        self.teams.insert(
            team_id.to_string(),
            TeamExecutionBranch {
                team_id: team_id.to_string(),
                micro_dag,
                is_finalized: false,
                promotion_manifest: None,
            },
        );
    }

    pub fn finalize_team_branch(
        &mut self,
        team_id: &str,
        manifest: PromotionManifest,
    ) -> Result<(), DagError> {
        let branch = self
            .teams
            .get_mut(team_id)
            .ok_or_else(|| DagError::TeamNotFound(team_id.to_string()))?;
        branch.is_finalized = true;
        branch.promotion_manifest = Some(manifest);
        Ok(())
    }

    /// Convergence Barrier:
    /// Checks if all parallel team branches have reached completion and published manifests.
    pub fn check_convergence_barrier(&self) -> Result<(), DagError> {
        let unfinalized: Vec<String> = self
            .teams
            .iter()
            .filter(|(_, branch)| !branch.is_finalized)
            .map(|(id, _)| id.clone())
            .collect();

        if !unfinalized.is_empty() {
            return Err(DagError::BarrierNotMet(unfinalized));
        }

        Ok(())
    }

    /// Federation Synthesis Gate:
    /// Executes when convergence barrier is satisfied, validating immutable URI pointers.
    pub fn merge_synthesis_gate(&self) -> Result<Vec<String>, DagError> {
        self.check_convergence_barrier()?;

        let mut validated_uris = Vec::new();
        for branch in self.teams.values() {
            if let Some(ref manifest) = branch.promotion_manifest {
                if manifest.artifact_uri.is_empty() {
                    return Err(DagError::InvalidManifest(format!(
                        "Team '{}' manifest contains empty artifact_uri",
                        branch.team_id
                    )));
                }
                validated_uris.push(manifest.artifact_uri.clone());
            }
        }

        validated_uris.sort();
        Ok(validated_uris)
    }
}
