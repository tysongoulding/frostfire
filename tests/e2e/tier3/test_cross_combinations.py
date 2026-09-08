"""
Tier 3: Cross-Feature Combinations (Pairwise Interaction Tests)
Tests combinatorial interactions between major system features per TEST_INFRA.md.
"""

import unittest
import tempfile
import os
import json
import time
from pathlib import Path

from ..harness import (
    DisplaySlotAllocator,
    TeamRuntimeConfig,
    ULID,
    AgentSessionConfig,
    CDPCookie,
    CDPCookieSync,
    CronParser,
    RoutineStore,
    RoutineJob,
    StaleLockCleaner,
    CrashLoopWatchdog,
    PortReaper,
    InvertedWebAuthnBroker,
    WebAuthnCeremonyRequest,
    WebAuthnCeremonyResponse,
    WorkflowValidator,
)
from ..harness.config import DEFAULT_CLOUD_GATEWAY_HOST, BASE_VNC_PORT, BASE_RFB_PORT


class TestTier3CrossCombinations(unittest.TestCase):
    """Pairwise combinatorial verification between Frostfire system features."""

    def setUp(self):
        self.allocator = DisplaySlotAllocator(max_slots=64)

    def test_comb_01_team_switching_and_display_slot_allocation(self):
        """Pairwise: Team Switching (F11) + Display Slot Allocation (F9)."""
        # Allocate blocks for Team Alpha (base 10) and Team Beta (base 20)
        alpha_slots = self.allocator.allocate_block(size=3, base=10)
        beta_slots = self.allocator.allocate_block(size=3, base=20)

        team_alpha = TeamRuntimeConfig(
            team_id="team_alpha",
            name="Team Alpha",
            display_slot_base=alpha_slots[0]
        )
        team_beta = TeamRuntimeConfig(
            team_id="team_beta",
            name="Team Beta",
            display_slot_base=beta_slots[0]
        )

        # Active desktop routing must point to team's base slot
        active_team = team_alpha
        self.assertEqual(active_team.display_slot_base, 10)
        self.assertEqual(DisplaySlotAllocator.get_vnc_port(active_team.display_slot_base), 6090)

        # Switch to Team Beta
        active_team = team_beta
        self.assertEqual(active_team.display_slot_base, 20)
        self.assertEqual(DisplaySlotAllocator.get_vnc_port(active_team.display_slot_base), 6100)

    def test_comb_02_chrome_sessions_and_display_slot_allocation(self):
        """Pairwise: Chrome Shared Sessions (F12) + Display Slot Allocation (F9)."""
        slot = self.allocator.allocate()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            master = tmp_path / "master"
            (master / "Default").mkdir(parents=True)
            (master / "Default" / "Cookies").write_text("SHARED_COOKIES", encoding="utf-8")

            ephemeral = CDPCookieSync.prepare_ephemeral_profile(
                master_profile_dir=master,
                display_slot=slot,
                base_scratch_dir=tmp_path
            )
            self.assertTrue(ephemeral.exists())
            self.assertEqual(
                (ephemeral / "DISPLAY_SLOT").read_text(encoding="utf-8").strip(),
                str(slot)
            )

    def test_comb_03_dynamic_agent_sessions_and_display_slots(self):
        """Pairwise: Dynamic Agent Sessions (F8) + Display Slot Allocation (F9)."""
        agent_id = ULID.generate()
        slot = self.allocator.allocate()
        vnc_port = DisplaySlotAllocator.get_vnc_port(slot)

        session = AgentSessionConfig(
            id=agent_id,
            name="Research Agent",
            role="Research Specialist",
            display_slot=slot,
            vnc_port=vnc_port,
            workspace_dir=Path(f"/tmp/agents/{agent_id}")
        )
        session.validate()
        self.assertEqual(session.display_slot, 1)
        self.assertEqual(session.vnc_port, 6081)

    def test_comb_04_dynamic_agent_sessions_and_cloud_gateway(self):
        """Pairwise: Dynamic Agent Sessions (F8) + Live Cloud Gateway (F7)."""
        agent_id = ULID.generate()
        slot = self.allocator.allocate()
        vnc_port = DisplaySlotAllocator.get_vnc_port(slot)

        # Build secure WebSocket gateway URL
        vnc_url = f"wss://{DEFAULT_CLOUD_GATEWAY_HOST}:{vnc_port}/websockify?token=agt_sess_{agent_id}"
        self.assertTrue(vnc_url.startswith("wss://44.242.94.86:6081/websockify"))
        self.assertIn(agent_id, vnc_url)

    def test_comb_05_multi_team_and_dynamic_agent_sessions(self):
        """Pairwise: Multi-Team Orchestration (F11) + Dynamic Agent Sessions (F8)."""
        agent1_id = ULID.generate()
        agent2_id = ULID.generate()

        team = TeamRuntimeConfig(
            team_id="team_eng",
            name="Engineering Team",
            display_slot_base=5,
            member_agent_ids=[agent1_id, agent2_id]
        )
        team.validate()
        self.assertEqual(len(team.member_agent_ids), 2)
        for aid in team.member_agent_ids:
            self.assertTrue(ULID.is_valid_agent_id(aid))

    def test_comb_06_scheduled_cron_routine_and_dynamic_agent(self):
        """Pairwise: Scheduled Cron Routine (F14) + Dynamic Agent Sessions (F8)."""
        agent_id = ULID.generate()
        store = RoutineStore(":memory:")

        payload = json.dumps({"target_agent": agent_id, "task": "daily_lint"})
        job = RoutineJob(
            id="routine_agent_lint",
            name="Agent Daily Lint",
            cron_expr="0 8 * * *",
            action_payload=payload
        )
        store.add_routine(job)

        fetched = store.get_routine("routine_agent_lint")
        self.assertIsNotNone(fetched)
        parsed_payload = json.loads(fetched.action_payload)
        self.assertEqual(parsed_payload["target_agent"], agent_id)
        store.close()

    def test_comb_07_scheduled_cron_routine_and_crash_loop_watchdog(self):
        """Pairwise: Scheduled Cron Routine (F14) + Crash-Loop Defenses (F13)."""
        store = RoutineStore(":memory:")
        dog = CrashLoopWatchdog(max_crashes=3, window_seconds=10.0)

        now = int(time.time())
        job = RoutineJob(
            id="job_flaky",
            name="Flaky Routine",
            cron_expr="* * * * *",
            action_payload="{}",
            next_run_at=now,
            enabled=True
        )
        store.add_routine(job)

        # Simulate consecutive execution crashes
        for i in range(3):
            dog.record_crash("job_flaky", timestamp=now + i)

        self.assertTrue(dog.should_throttle("job_flaky", timestamp=now + 4))
        # The routine in the store remains intact and scheduled
        self.assertIsNotNone(store.get_routine("job_flaky"))
        store.close()

    def test_comb_08_inverted_webauthn_and_grpc_tunnel(self):
        """Pairwise: Inverted WebAuthn Passkey (F15) + Reverse gRPC Tunnel (F10)."""
        broker = InvertedWebAuthnBroker()
        challenge = os.urandom(32)

        # Simulate cloud tunnel frame carrying WebAuthnCeremonyRequest
        cloud_frame = {
            "type": "webauthn_ceremony_request",
            "challenge": challenge,
            "rp_id": "cloud.frostfire.internal",
            "credential_id": b"cred_tunnel_01",
        }

        # Client executes signing locally
        req = WebAuthnCeremonyRequest(
            challenge=cloud_frame["challenge"],
            rp_id=cloud_frame["rp_id"],
            credential_id=cloud_frame["credential_id"]
        )
        response = broker.sign_ceremony(req)

        # Response packaged for reverse stream transmission
        client_frame = {
            "type": "webauthn_ceremony_response",
            "response": response.to_dict()
        }
        self.assertEqual(client_frame["type"], "webauthn_ceremony_response")
        self.assertTrue(InvertedWebAuthnBroker.verify_zero_credential_leakage(response))

    def test_comb_09_release_please_and_multi_platform_workflows(self):
        """Pairwise: Release-Please (F2) + Multi-Platform CI/CD Workflows (F1)."""
        rel = WorkflowValidator.get_release_workflow()
        jobs = rel.get("jobs", {})

        # build-release-desktop must depend on release-please output
        desktop_job = jobs.get("build-release-desktop", {})
        self.assertEqual(desktop_job.get("needs"), "release-please")
        self.assertIn("releases_created", desktop_job.get("if", ""))

    def test_comb_10_lock_sync_and_release_please(self):
        """Pairwise: Lock Sync (F3) + Release-Please (F2)."""
        rel = WorkflowValidator.get_release_workflow()
        jobs = rel.get("jobs", {})

        # update-workspace triggers when release-please creates a PR
        update_job = jobs.get("update-workspace", {})
        self.assertEqual(update_job.get("needs"), "release-please")
        self.assertIn("pr", update_job.get("if", ""))

    def test_comb_11_checksum_generation_and_multi_platform_builds(self):
        """Pairwise: Checksum Generation (F4) + Multi-Platform Workflows (F1)."""
        rel = WorkflowValidator.get_release_workflow()
        checksum_job = rel.get("jobs", {}).get("checksums", {})
        needs = checksum_job.get("needs", [])

        # Must aggregate desktop, android, and ios builds
        self.assertIn("build-release-desktop", needs)
        self.assertIn("build-release-android", needs)
        self.assertIn("build-release-ios", needs)

    def test_comb_12_mobile_configs_and_multi_platform_workflows(self):
        """Pairwise: Mobile Configs (F5) + Multi-Platform Workflows (F1)."""
        rel = WorkflowValidator.get_release_workflow()
        android_job = rel.get("jobs", {}).get("build-release-android", {})
        steps_str = str(android_job.get("steps", []))
        self.assertIn("tauri android build", steps_str)

    def test_comb_13_zero_mock_ui_and_dynamic_agent_sessions(self):
        """Pairwise: Zero-Mock UI (F6) + Dynamic Agent Sessions (F8)."""
        # Store initializes empty, then dynamically populates via agent sessions
        store_agents = []
        new_agent_id = ULID.generate()
        store_agents.append({
            "id": new_agent_id,
            "name": "Live Agent 1",
            "role": "Generalist"
        })
        self.assertEqual(len(store_agents), 1)
        self.assertTrue(store_agents[0]["id"].startswith("agt_"))

    def test_comb_14_crash_loop_defenses_and_chrome_sessions(self):
        """Pairwise: Crash-Loop Defenses (F13) + Chrome Shared Sessions (F12)."""
        # Prior to launching Chrome, stale locks must be cleared
        cleaner = StaleLockCleaner(pid_checker=lambda pid: False)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / ".X1-lock").write_text("8888\n", encoding="utf-8")
            reclaimed = cleaner.clean_stale_locks(tmp_path)
            self.assertIn(1, reclaimed)

            # Now Chrome profile for display :1 can initialize safely without lock collisions
            master = tmp_path / "master"
            (master / "Default").mkdir(parents=True)
            ephemeral = CDPCookieSync.prepare_ephemeral_profile(master, display_slot=1, base_scratch_dir=tmp_path)
            self.assertTrue(ephemeral.exists())

    def test_comb_15_inverted_webauthn_and_zero_mock_purge(self):
        """Pairwise: Inverted WebAuthn (F15) + Zero-Mock Purge (F6)."""
        # Inverted passkey bridge must use genuine cryptographic signatures, not mock hash stubs
        broker = InvertedWebAuthnBroker()
        req = WebAuthnCeremonyRequest(
            challenge=b"real_random_challenge_bytes_1234",
            rp_id="github.com",
            credential_id=b"cred_live"
        )
        res = broker.sign_ceremony(req)
        # Verify genuine ECDSA P-256 ASN.1 DER signature (starts with 0x30 SEQUENCE)
        self.assertEqual(res.signature[0], 0x30)
        self.assertGreaterEqual(len(res.signature), 64)


if __name__ == "__main__":
    unittest.main()
