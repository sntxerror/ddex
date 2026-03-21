#!/usr/bin/env python3
"""
Convert a BIP-39 mnemonic phrase to entropy (hex-encoded 32 bytes).
This is used to interface with the mobilecoind JSON API which expects entropy.
"""

import sys
import json

try:
    from mnemonic import Mnemonic
except ImportError:
    print("Error: The 'mnemonic' library is not installed.", file=sys.stderr)
    print("Install it with: pip install mnemonic", file=sys.stderr)
    sys.exit(1)


def mnemonic_to_entropy(mnemonic_phrase: str) -> str:
    """
    Convert a BIP-39 mnemonic phrase to entropy (hex-encoded).

    Args:
        mnemonic_phrase: A space-separated BIP-39 mnemonic phrase

    Returns:
        Hex-encoded entropy string (64 hex characters for 32 bytes)
    """
    mnemo = Mnemonic('english')

    # Validate mnemonic
    if not mnemo.check(mnemonic_phrase):
        raise ValueError("Invalid mnemonic phrase")

    # Get entropy from mnemonic
    entropy = mnemo.to_entropy(mnemonic_phrase)
    return entropy.hex()


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 mnemonic_to_entropy.py '<mnemonic phrase>'", file=sys.stderr)
        print("", file=sys.stderr)
        print("Example:", file=sys.stderr)
        print("  python3 mnemonic_to_entropy.py 'muffin rare crime tired ginger rice jump output luxury submit way search upon glass tenant electric bargain apology right promote divide myth minute invest'", file=sys.stderr)
        sys.exit(1)

    mnemonic_phrase = sys.argv[1]

    try:
        entropy = mnemonic_to_entropy(mnemonic_phrase)
        print(entropy)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
