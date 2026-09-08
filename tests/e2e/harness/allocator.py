"""
Display slot allocator and port calculation engine.
Implements requirement R2 display slot assignment (:1, :2, ...) and port mapping.
"""

from typing import Set, Optional, List
from .config import BASE_VNC_PORT, BASE_RFB_PORT


class DisplaySlotAllocator:
    """Manages allocation, recycling, and port derivation for cloud display slots."""

    def __init__(self, max_slots: int = 64):
        self.max_slots = max_slots
        self._allocated: Set[int] = set()

    def allocate(self, preferred_slot: Optional[int] = None) -> int:
        """Allocates the lowest available slot, or preferred_slot if specified and free."""
        if preferred_slot is not None:
            if preferred_slot < 1 or preferred_slot > self.max_slots:
                raise ValueError(
                    f"Slot {preferred_slot} is out of bounds [1, {self.max_slots}]"
                )
            if preferred_slot in self._allocated:
                raise ValueError(f"Slot {preferred_slot} is already allocated")
            self._allocated.add(preferred_slot)
            return preferred_slot

        for slot in range(1, self.max_slots + 1):
            if slot not in self._allocated:
                self._allocated.add(slot)
                return slot

        raise RuntimeError(f"Display slot pool exhausted (max {self.max_slots} slots)")

    def allocate_block(self, size: int, base: Optional[int] = None) -> List[int]:
        """Allocates a contiguous block of display slots (e.g. for a team)."""
        if size < 1:
            raise ValueError("Block size must be >= 1")
        if base is not None:
            if base < 1 or base + size - 1 > self.max_slots:
                raise ValueError(f"Block [{base}, {base + size - 1}] is out of bounds")
            for s in range(base, base + size):
                if s in self._allocated:
                    raise ValueError(f"Slot {s} in requested block is already allocated")
            for s in range(base, base + size):
                self._allocated.add(s)
            return list(range(base, base + size))

        # Find first contiguous free block
        for start in range(1, self.max_slots - size + 2):
            block = range(start, start + size)
            if all(s not in self._allocated for s in block):
                for s in block:
                    self._allocated.add(s)
                return list(block)

        raise RuntimeError(f"Could not find contiguous block of size {size}")

    def release(self, slot: int) -> None:
        """Releases an allocated slot back to the free pool."""
        if slot not in self._allocated:
            raise ValueError(f"Slot {slot} is not currently allocated")
        self._allocated.remove(slot)

    def release_block(self, slots: List[int]) -> None:
        for s in slots:
            self.release(s)

    def is_allocated(self, slot: int) -> bool:
        return slot in self._allocated

    @property
    def allocated_count(self) -> int:
        return len(self._allocated)

    @staticmethod
    def get_vnc_port(slot: int) -> int:
        if slot < 1:
            raise ValueError(f"Invalid display slot {slot}")
        port = BASE_VNC_PORT + slot
        if port > 65535:
            raise ValueError(f"Port {port} exceeds max port 65535")
        return port

    @staticmethod
    def get_rfb_port(slot: int) -> int:
        if slot < 1:
            raise ValueError(f"Invalid display slot {slot}")
        port = BASE_RFB_PORT + slot
        if port > 65535:
            raise ValueError(f"Port {port} exceeds max port 65535")
        return port
