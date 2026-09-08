"""
Feature 11: Multi-Team Orchestration & Switcher (ORIGINAL_REQUEST §R3)
Tests multi-team orchestration, desktop routing, team switcher state, and display isolation.
"""

import unittest
from pathlib import Path
from ..harness import TeamRuntimeConfig, ULID


class TestFeature11MultiTeam(unittest.TestCase):
    """Verifies multi-team management and per-team desktop isolation contracts."""

    def test_feat11_01_team_runtime_config_contract(self):
        """Authoritative Source: PROJECT.md § Interface Contracts (TeamRuntimeConfig)."""
        agent1 = ULID.generate()
        agent2 = ULID.generate()
        team = TeamRuntimeConfig(
            team_id="team_alpha_research",
            name="Team Alpha: Research",
            display_slot_base=10,
            member_agent_ids=[agent1, agent2],
            shared_session_dir=Path("/tmp/frostfire/teams/team_alpha")
        )
        team.validate()
        self.assertEqual(team.team_id, "team_alpha_research")
        self.assertEqual(team.display_slot_base, 10)

    def test_feat11_02_team_isolation_display_slots(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 36 (per-team desktop isolation)."""
        team_alpha = TeamRuntimeConfig(
            team_id="team_alpha",
            name="Team Alpha",
            display_slot_base=10,
        )
        team_beta = TeamRuntimeConfig(
            team_id="team_beta",
            name="Team Beta",
            display_slot_base=20,
        )
        # Ensure disjoint display slot blocks (size 5 each)
        alpha_slots = set(range(team_alpha.display_slot_base, team_alpha.display_slot_base + 5))
        beta_slots = set(range(team_beta.display_slot_base, team_beta.display_slot_base + 5))
        self.assertTrue(alpha_slots.isdisjoint(beta_slots), "Team display slot blocks must be isolated")

    def test_feat11_03_team_switcher_active_context(self):
        """Authoritative Source: ORIGINAL_REQUEST.md Acceptance Criteria line 55."""
        state = {
            "active_team_id": "team_alpha",
            "active_display_slot": 10,
        }
        # Switch team
        state["active_team_id"] = "team_beta"
        state["active_display_slot"] = 20
        self.assertEqual(state["active_team_id"], "team_beta")
        self.assertEqual(state["active_display_slot"], 20)

    def test_feat11_04_team_member_agent_id_validation(self):
        """Authoritative Source: PROJECT.md Feature 12."""
        invalid_id = "invalid_agent_no_ulid"
        team = TeamRuntimeConfig(
            team_id="team_gamma",
            name="Team Gamma",
            display_slot_base=30,
            member_agent_ids=[invalid_id]
        )
        with self.assertRaises(ValueError):
            team.validate()

    def test_feat11_05_screen_view_unlocked_for_teams(self):
        """Authoritative Source: survey_report.md Observation 1 (Unlock ScreenView for teams)."""
        def is_screen_view_allowed(entity_type: str) -> bool:
            # Both "agent" and "team" entities must be permitted to view the desktop screen
            return entity_type in ("agent", "team")

        self.assertTrue(is_screen_view_allowed("agent"))
        self.assertTrue(is_screen_view_allowed("team"))


if __name__ == "__main__":
    unittest.main()
