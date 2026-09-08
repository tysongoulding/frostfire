//! Frostfire E2E Test Suite and Verification Harness
//!
//! Provides opaque-box testing across Tiers 1-4 for the Frostfire Cloud control plane,
//! reverse-tunnel gateway, microVM virtualization infrastructure, and AWS deployment automation.

pub mod harness;
pub mod mock_gateway;
pub mod mock_client;
pub mod assertions;

pub use mock_gateway::{MockGatewayHandle, MockSessionRegistry};
pub use mock_client::SimulatedDesktopClient;
pub use assertions::*;
pub use harness::*;
