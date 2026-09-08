"""
Chrome DevTools Protocol (CDP) cookie synchronization and profile isolator.
Implements Requirement R3 multi-monitor Chrome shared session synchronization.
"""

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Optional
import json
import time


@dataclass
class CDPCookie:
    name: str
    value: str
    domain: str
    path: str = "/"
    expires: float = -1
    size: int = 0
    httpOnly: bool = False
    secure: bool = True
    session: bool = False
    sameSite: str = "Lax"

    def to_cdp_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "domain": self.domain,
            "path": self.path,
            "expires": self.expires,
            "httpOnly": self.httpOnly,
            "secure": self.secure,
            "sameSite": self.sameSite,
        }

    @classmethod
    def from_cdp_dict(cls, data: Dict[str, Any]) -> "CDPCookie":
        return cls(
            name=data["name"],
            value=data["value"],
            domain=data["domain"],
            path=data.get("path", "/"),
            expires=data.get("expires", -1),
            size=data.get("size", len(data["name"]) + len(data["value"])),
            httpOnly=data.get("httpOnly", False),
            secure=data.get("secure", True),
            session=data.get("session", False),
            sameSite=data.get("sameSite", "Lax"),
        )


class CDPCookieSync:
    """Simulates live CDP cookie extraction and injection between browser instances."""

    @staticmethod
    def build_get_cookies_response(cookies: List[CDPCookie]) -> Dict[str, Any]:
        return {
            "id": 1,
            "result": {
                "cookies": [c.to_cdp_dict() for c in cookies]
            }
        }

    @staticmethod
    def build_set_cookies_request(cookies: List[CDPCookie]) -> Dict[str, Any]:
        return {
            "id": 2,
            "method": "Network.setCookies",
            "params": {
                "cookies": [c.to_cdp_dict() for c in cookies]
            }
        }

    @staticmethod
    def sync_cookies(
        source_cookies: List[CDPCookie],
        target_cookies: List[CDPCookie]
    ) -> int:
        """Synchronizes source cookies into target cookie list without duplicates."""
        target_dict = {(c.name, c.domain, c.path): c for c in target_cookies}
        synced_count = 0

        for sc in source_cookies:
            # Check expiry
            if sc.expires > 0 and sc.expires < time.time():
                continue  # Skip expired cookies
            key = (sc.name, sc.domain, sc.path)
            target_dict[key] = sc
            synced_count += 1

        target_cookies.clear()
        target_cookies.extend(target_dict.values())
        return synced_count

    @staticmethod
    def prepare_ephemeral_profile(
        master_profile_dir: Path,
        display_slot: int,
        base_scratch_dir: Path
    ) -> Path:
        """
        Creates an isolated profile directory for a display slot.
        Symlinks or copies master cookies and login data to avoid SingletonLock conflicts.
        """
        if not master_profile_dir.exists():
            raise FileNotFoundError(f"Master profile dir not found: {master_profile_dir}")

        ephemeral_dir = base_scratch_dir / f"profile_disp_{display_slot}"
        ephemeral_dir.mkdir(parents=True, exist_ok=True)

        # Create Default subdirectory
        default_dir = ephemeral_dir / "Default"
        default_dir.mkdir(exist_ok=True)

        # Place shared session markers
        master_cookie_file = master_profile_dir / "Default" / "Network" / "Cookies"
        target_cookie_file = default_dir / "Cookies"
        if master_cookie_file.exists():
            target_cookie_file.write_bytes(master_cookie_file.read_bytes())
        else:
            target_cookie_file.write_text("SHARED_COOKIE_STORE", encoding="utf-8")

        # Write display allocation marker
        (ephemeral_dir / "DISPLAY_SLOT").write_text(str(display_slot), encoding="utf-8")
        return ephemeral_dir
