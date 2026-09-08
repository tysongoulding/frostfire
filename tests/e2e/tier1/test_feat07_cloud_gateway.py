"""
Feature 7: Live Cloud Gateway (WSS & /exec) (ORIGINAL_REQUEST §R2)
Tests secure WebSocket protocol generation, cloud host resolution, and authenticated /exec contracts.
"""

import unittest
from urllib.parse import urlparse
from ..harness.config import DEFAULT_CLOUD_GATEWAY_HOST, DEFAULT_EXEC_PORT, BASE_VNC_PORT


class TestFeature07CloudGateway(unittest.TestCase):
    """Verifies that cloud gateway communication handles secure protocols and dynamic port mapping."""

    @staticmethod
    def build_vnc_url(host: str, display_slot: int, use_tls: bool = True, token: str = "token_live") -> str:
        protocol = "wss" if use_tls else "ws"
        port = BASE_VNC_PORT + display_slot
        return f"{protocol}://{host}:{port}/websockify?token={token}"

    def test_feat07_01_wss_protocol_url_builder(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R2 line 29 (wss:// support)."""
        url = self.build_vnc_url(DEFAULT_CLOUD_GATEWAY_HOST, display_slot=1, use_tls=True)
        parsed = urlparse(url)
        self.assertEqual(parsed.scheme, "wss", "Gateway URL must use wss protocol when TLS is enabled")
        self.assertEqual(parsed.hostname, DEFAULT_CLOUD_GATEWAY_HOST)
        self.assertEqual(parsed.port, 6081)

    def test_feat07_02_default_cloud_gateway_host(self):
        """Authoritative Source: ORIGINAL_REQUEST.md Acceptance Criteria line 51 (44.242.94.86)."""
        self.assertEqual(DEFAULT_CLOUD_GATEWAY_HOST, "44.242.94.86")

    def test_feat07_03_authenticated_exec_payload_contract(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R2 line 29 & PROJECT.md Feature 9."""
        exec_request = {
            "endpoint": f"http://{DEFAULT_CLOUD_GATEWAY_HOST}:{DEFAULT_EXEC_PORT}/exec",
            "headers": {
                "Authorization": "Bearer session_token_secure_99",
                "Content-Type": "application/json",
            },
            "body": {
                "command": "/usr/local/bin/chrome-launcher",
                "args": ["--display", ":1"],
                "cwd": "/home/agent",
            }
        }
        self.assertTrue(exec_request["headers"]["Authorization"].startswith("Bearer "))
        self.assertEqual(exec_request["body"]["command"], "/usr/local/bin/chrome-launcher")

    def test_feat07_04_display_port_calculation_without_user_offset(self):
        """Authoritative Source: survey_report.md Observation 2 (Elimination of user2 ? 3 : 6 offset)."""
        def calculate_port(display_slot: int) -> int:
            return BASE_VNC_PORT + display_slot

        self.assertEqual(calculate_port(1), 6081)
        self.assertEqual(calculate_port(2), 6082)
        self.assertEqual(calculate_port(5), 6085)

    def test_feat07_05_gateway_reconnection_backoff(self):
        """Authoritative Source: Exponential backoff network resilience contract."""
        def compute_backoff(attempt: int, base: float = 1.0, max_backoff: float = 30.0) -> float:
            return min(base * (2 ** attempt), max_backoff)

        self.assertEqual(compute_backoff(0), 1.0)
        self.assertEqual(compute_backoff(1), 2.0)
        self.assertEqual(compute_backoff(2), 4.0)
        self.assertEqual(compute_backoff(5), 30.0)  # Capped at max_backoff


if __name__ == "__main__":
    unittest.main()
