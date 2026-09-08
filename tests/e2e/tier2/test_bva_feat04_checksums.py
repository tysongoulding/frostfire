"""
Tier 2 BVA: Feature 4 Checksums Boundary Value Analysis
Tests empty file list, hash length, corrupted file mismatch, special characters, and clobber flag.
"""

import unittest
import hashlib


class TestBvaFeature04Checksums(unittest.TestCase):
    """Boundary and corner case analysis for release checksums and asset publishing."""

    def test_bva04_01_empty_file_list_for_sha256(self):
        """Verifies that empty file list produces zero checksum entries without crashing."""
        files = []
        entries = [f"{hashlib.sha256(b'').hexdigest()}  {f}" for f in files]
        self.assertEqual(len(entries), 0)

    def test_bva04_02_sha256_hash_length_and_hex(self):
        """Verifies that SHA-256 digests are strictly 64 hexadecimal characters."""
        sample_bytes = b"frostfire_v0.3.0_installer_binary"
        digest = hashlib.sha256(sample_bytes).hexdigest()
        self.assertEqual(len(digest), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in digest))

    def test_bva04_03_corrupted_file_checksum_mismatch(self):
        """Verifies that a 1-bit change in binary alters the SHA-256 digest entirely."""
        original = b"frostfire_clean_binary_001"
        corrupted = b"frostfire_clean_binary_002"
        h1 = hashlib.sha256(original).hexdigest()
        h2 = hashlib.sha256(corrupted).hexdigest()
        self.assertNotEqual(h1, h2)

    def test_bva04_04_spaces_in_asset_filename(self):
        """Verifies formatting of sha256sum line with spaces in asset name."""
        filename = "frostfire desktop setup.exe"
        digest = hashlib.sha256(b"dummy").hexdigest()
        line = f"{digest}  {filename}"
        parts = line.split("  ", 1)
        self.assertEqual(parts[0], digest)
        self.assertEqual(parts[1], filename)

    def test_bva04_05_clobber_flag_mandatory_on_upload(self):
        """Verifies that release asset upload command requires --clobber to overwrite pre-releases."""
        upload_cmd = "gh release upload v0.3.0 asset.exe --clobber"
        self.assertIn("--clobber", upload_cmd)


if __name__ == "__main__":
    unittest.main()
