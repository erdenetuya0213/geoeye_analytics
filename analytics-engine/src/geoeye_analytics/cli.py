from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence

from .providers import provider_catalog


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GeoEye local analytics engine")
    subcommands = parser.add_subparsers(dest="command", required=True)
    providers = subcommands.add_parser("providers", help="Report optional provider availability as JSON")
    providers.add_argument(
        "--gslib-bin-dir",
        default=os.environ.get("GEOEYE_GSLIB_BIN"),
        help="Directory containing user-provided GSLIB executables",
    )
    return parser


def main(arguments: Sequence[str] | None = None) -> int:
    parsed = build_parser().parse_args(arguments)
    if parsed.command == "providers":
        print(
            json.dumps(
                [descriptor.to_dict() for descriptor in provider_catalog(parsed.gslib_bin_dir)],
                indent=2,
            )
        )
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

