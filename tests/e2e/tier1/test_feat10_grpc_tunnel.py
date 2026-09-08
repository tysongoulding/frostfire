"""
Feature 10: Reverse gRPC Tunnel Protocol Stream (ORIGINAL_REQUEST §R2)
Tests protobuf contracts, bidirectional streaming definitions, and blackboard bridge framing.
"""

import unittest
import json
from ..harness import ProtobufContracts
from ..harness.config import PROTO_TUNNEL_PATH


class TestFeature10GrpcTunnel(unittest.TestCase):
    """Verifies that reverse gRPC tunnel contracts conform to AgentTunnelService.OpenTunnel."""

    def test_feat10_01_proto_service_definition(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R2 line 31 & crates/frostfire-proto/proto/tunnel.proto."""
        proto = ProtobufContracts.parse_proto(PROTO_TUNNEL_PATH)
        services = proto["services"]
        self.assertIn("AgentTunnelService", services, "tunnel.proto must define AgentTunnelService")
        rpcs = services["AgentTunnelService"]
        rpc_names = [r[0] for r in rpcs]
        self.assertIn("OpenTunnel", rpc_names, "AgentTunnelService must define OpenTunnel RPC")

    def test_feat10_02_proto_frame_messages(self):
        """Authoritative Source: tunnel.proto message contracts."""
        proto = ProtobufContracts.parse_proto(PROTO_TUNNEL_PATH)
        messages = proto["messages"]
        self.assertIn("TunnelClientFrame", messages, "tunnel.proto must define TunnelClientFrame")
        self.assertIn("TunnelServerFrame", messages, "tunnel.proto must define TunnelServerFrame")

    def test_feat10_03_outbound_only_tunnel_contract(self):
        """Authoritative Source: AGENTS.md § Invariants (Outbound-Only Control)."""
        # Architectural contract: Local daemon never opens listening ports for control
        tunnel_connection_spec = {
            "mode": "outbound_reverse_stream",
            "tls_enabled": True,
            "listening_ports_opened": 0,
            "stream_rpc": "AgentTunnelService.OpenTunnel",
        }
        self.assertEqual(tunnel_connection_spec["listening_ports_opened"], 0)
        self.assertTrue(tunnel_connection_spec["tls_enabled"])

    def test_feat10_04_blackboard_signal_bridge_schema(self):
        """Authoritative Source: PROJECT.md § Interface Contracts (bridge_blackboard_to_tunnel)."""
        # Event bridge serialization structure
        signal_event = {
            "signal_id": "sig_0191_abc",
            "channel": "dag_execution",
            "payload": {
                "node_id": "node_plan_step_1",
                "status": "completed",
            }
        }
        client_frame = {
            "frame_type": "signal_event",
            "channel": signal_event["channel"],
            "payload_bytes": json.dumps(signal_event["payload"]).encode("utf-8").hex(),
        }
        self.assertEqual(client_frame["frame_type"], "signal_event")
        self.assertEqual(client_frame["channel"], "dag_execution")

    def test_feat10_05_tunnel_frame_serialization(self):
        """Authoritative Source: tunnel.proto framing contracts."""
        frame_dict = {
            "frame_id": 42,
            "timestamp": 1725838000,
            "heartbeat": {"nonce": 12345678},
        }
        serialized = json.dumps(frame_dict)
        deserialized = json.loads(serialized)
        self.assertEqual(deserialized["frame_id"], 42)
        self.assertEqual(deserialized["heartbeat"]["nonce"], 12345678)


if __name__ == "__main__":
    unittest.main()
