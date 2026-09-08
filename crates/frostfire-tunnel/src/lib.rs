pub mod client;
pub mod error;
pub mod mock_server;

pub use client::{TunnelClient, TunnelConfig, TunnelHandle};
pub use error::{Result, TunnelError};
pub use frostfire_proto::tunnel;
pub use mock_server::MockGatewayServer;
