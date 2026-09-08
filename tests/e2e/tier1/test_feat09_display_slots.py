"""
Feature 9: Display Slot Allocation (:1, :2..) (ORIGINAL_REQUEST §R2)
Tests dynamic slot allocation, port derivation, recycling, and collision prevention.
"""

import unittest
from ..harness import DisplaySlotAllocator


class TestFeature09DisplaySlots(unittest.TestCase):
    """Verifies that cloud display slots (:1, :2, ...) and corresponding ports are cleanly managed."""

    def setUp(self):
        self.allocator = DisplaySlotAllocator(max_slots=32)

    def test_feat09_01_allocate_lowest_available_slot(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R2 line 32 (:1, :2, :3, ...)."""
        slot1 = self.allocator.allocate()
        slot2 = self.allocator.allocate()
        slot3 = self.allocator.allocate()
        self.assertEqual(slot1, 1)
        self.assertEqual(slot2, 2)
        self.assertEqual(slot3, 3)

    def test_feat09_02_vnc_and_rfb_port_derivation(self):
        """Authoritative Source: PROJECT.md § Interface Contracts lines 59-60."""
        self.assertEqual(DisplaySlotAllocator.get_vnc_port(1), 6081)
        self.assertEqual(DisplaySlotAllocator.get_vnc_port(2), 6082)
        self.assertEqual(DisplaySlotAllocator.get_rfb_port(1), 5901)
        self.assertEqual(DisplaySlotAllocator.get_rfb_port(2), 5902)

    def test_feat09_03_slot_release_and_reuse(self):
        """Authoritative Source: Dynamic cloud display recycling specification."""
        s1 = self.allocator.allocate()
        s2 = self.allocator.allocate()
        self.assertEqual(s1, 1)
        self.assertEqual(s2, 2)

        self.allocator.release(s1)
        self.assertFalse(self.allocator.is_allocated(s1))

        # Re-allocating should recycle slot 1 (lowest available)
        reused = self.allocator.allocate()
        self.assertEqual(reused, 1)

    def test_feat09_04_slot_collision_prevention(self):
        """Authoritative Source: Collision avoidance invariant across concurrent agents."""
        self.allocator.allocate(preferred_slot=5)
        with self.assertRaises(ValueError):
            self.allocator.allocate(preferred_slot=5)

    def test_feat09_05_block_allocation_for_teams(self):
        """Authoritative Source: PROJECT.md § Interface Contracts (TeamRuntimeConfig display_slot_base)."""
        team_block = self.allocator.allocate_block(size=4, base=10)
        self.assertEqual(team_block, [10, 11, 12, 13])
        for s in team_block:
            self.assertTrue(self.allocator.is_allocated(s))


if __name__ == "__main__":
    unittest.main()
