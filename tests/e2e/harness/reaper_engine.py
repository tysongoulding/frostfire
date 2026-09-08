"""
Crash-loop defenses, stale lock cleaning, and orphan process reaping.
Implements Requirement R3 crash-loop defenses & orphan reaping.
"""

from typing import Dict, List, Set, Optional, Callable
from pathlib import Path
import time
import os


class StaleLockCleaner:
    """Detects and cleans orphaned X11 display locks and Unix domain sockets."""

    @staticmethod
    def is_pid_alive_default(pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            # On Windows/POSIX, os.kill(pid, 0) checks if process exists without killing it
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError, PermissionError):
            # PermissionError means the process exists but is owned by another user (still alive!)
            import sys
            if sys.platform == "win32":
                # On Windows, os.kill(pid, 0) might raise PermissionError or OSError
                import ctypes
                kernel32 = ctypes.windll.kernel32
                PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
                h_proc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                if h_proc:
                    kernel32.CloseHandle(h_proc)
                    return True
                return False
            return False

    def __init__(self, pid_checker: Optional[Callable[[int], bool]] = None):
        self.is_pid_alive = pid_checker or self.is_pid_alive_default

    def clean_stale_locks(self, tmp_dir: Path) -> List[int]:
        """
        Scans tmp_dir for .X*-lock files and corresponding .X11-unix/X* sockets.
        Deletes locks and sockets if the holding PID is deceased.
        Returns the list of reclaimed display numbers.
        """
        reclaimed_displays: List[int] = []
        if not tmp_dir.exists():
            return reclaimed_displays

        for lock_file in tmp_dir.glob(".X*-lock"):
            name = lock_file.name
            # Format: .X{display}-lock
            display_str = name[2:-5]
            if not display_str.isdigit():
                continue
            display_num = int(display_str)

            # Read PID from lock file
            try:
                content = lock_file.read_text(encoding="utf-8").strip()
                pid = int(content)
            except Exception:
                # Corrupted lock file: treat as stale
                pid = -1

            if not self.is_pid_alive(pid):
                # PID is dead, unlink lock and socket
                try:
                    lock_file.unlink(missing_ok=True)
                except OSError:
                    pass

                socket_file = tmp_dir / ".X11-unix" / f"X{display_num}"
                try:
                    socket_file.unlink(missing_ok=True)
                except OSError:
                    pass

                reclaimed_displays.append(display_num)

        return reclaimed_displays


class CrashLoopWatchdog:
    """Sliding-window watchdog that detects crash loops and enforces exponential backoff."""

    def __init__(self, max_crashes: int = 3, window_seconds: float = 10.0, base_backoff_seconds: float = 2.0):
        self.max_crashes = max_crashes
        self.window_seconds = window_seconds
        self.base_backoff_seconds = base_backoff_seconds
        self._history: Dict[str, List[float]] = {}
        self._backoff_level: Dict[str, int] = {}

    def record_crash(self, service_id: str, timestamp: Optional[float] = None) -> None:
        if timestamp is None:
            timestamp = time.time()
        crashes = self._history.setdefault(service_id, [])
        crashes.append(timestamp)

        # Prune crashes outside the sliding window
        cutoff = timestamp - self.window_seconds
        self._history[service_id] = [t for t in crashes if t >= cutoff]

    def should_throttle(self, service_id: str, timestamp: Optional[float] = None) -> bool:
        if timestamp is None:
            timestamp = time.time()
        crashes = self._history.get(service_id, [])
        cutoff = timestamp - self.window_seconds
        recent = [t for t in crashes if t >= cutoff]
        self._history[service_id] = recent
        return len(recent) >= self.max_crashes

    def get_backoff_seconds(self, service_id: str) -> float:
        crashes = len(self._history.get(service_id, []))
        if crashes < self.max_crashes:
            return 0.0
        multiplier = 2 ** (crashes - self.max_crashes)
        return min(self.base_backoff_seconds * multiplier, 60.0)

    def reset(self, service_id: str) -> None:
        self._history.pop(service_id, None)
        self._backoff_level.pop(service_id, None)


class PortReaper:
    """Inspects and recycles RFB and VNC ports when associated processes die."""

    def __init__(self, pid_checker: Optional[Callable[[int], bool]] = None):
        self.is_pid_alive = pid_checker or StaleLockCleaner.is_pid_alive_default
        self._port_bindings: Dict[int, int] = {}  # port -> pid

    def register_binding(self, port: int, pid: int) -> None:
        if port < 1024:
            raise ValueError(f"Cannot manage privileged port {port}")
        self._port_bindings[port] = pid

    def is_port_in_use(self, port: int) -> bool:
        pid = self._port_bindings.get(port)
        if pid is None:
            return False
        return self.is_pid_alive(pid)

    def reap_stale_ports(self) -> List[int]:
        reaped: List[int] = []
        for port, pid in list(self._port_bindings.items()):
            if not self.is_pid_alive(pid):
                del self._port_bindings[port]
                reaped.append(port)
        return reaped
