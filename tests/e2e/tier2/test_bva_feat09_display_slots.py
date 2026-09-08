"""
Tier 2 BVA: Feature 9 Display Slots Boundary Value Analysis
Tests slot zero, pool exhaustion, double release, churn cycling, and block bounds.
"""

import unittest
from ..harness import DisplaySlotAllocator


class TestBvaFeature09DisplaySlots(unittest.TestCase):
    """Boundary and corner case analysis for display slot allocator."""

    def test_bva09_01_slot_zero_boundary(self):
        """Verifies that requesting slot 0 raises ValueError (system is 1-indexed)."""
        allocator = DisplaySlotAllocator(max_slots=10)
        with self.assertRaises(ValueError):
            allocator.allocate(preferred_slot=0)

    def test_bva09_02_slot_pool_exhaustion(self):
        """Verifies that exceeding max_slots raises RuntimeError."""
        allocator = DisplaySlotAllocator(max_slots=3)
        allocator.allocate()
        allocator.allocate()
        allocator.allocate()
        with self.assertRaises(RuntimeError):
            allocator.allocate()

    def test_bva09_03_double_release_error(self):
        """Verifies that releasing an unallocated slot raises ValueError."""
        allocator = DisplaySlotAllocator(max_slots=5)
        with self.assertRaises(ValueError):
            allocator.release(1)

        slot = allocator.allocate()
        allocator.release(slot)
        with self.assertRaises(ValueError):
            allocator.release(slot)

    def test_bva09_04_rapid_allocation_cycling(self):
        """Verifies allocation stability under 100 rapid churn cycles."""
        allocator = DisplaySlotAllocator(max_slots=8)
        for _ in range(100):
            s = allocator.allocate()
            self.assertEqual(s, 1)  # Recycled immediately
            allocator.release(s)
        self.assertEqual(allocator.allocated_count, 0)

    def test_bva09_05_contiguous_block_exhaustion(self):
        """Verifies that requesting a block larger than available capacity raises RuntimeError."""
        allocator = DisplaySlotAllocator(max_slots=4)
        with self.assertRaises(RuntimeError):
            allocator.allocate_block(size=5)


if __name__ == "__main__":
    unittest.main()
