#!/usr/bin/env python3
"""
SkyOps Main Merge Automation
Automates branch sync after merging PRs to main.
"""

from __future__ import annotations

import os

# --- Ensure this script can always import sibling modules (like utility_functions.py) ---
import sys

# Resolve absolute path to this script's directory
script_dir = os.path.dirname(os.path.abspath(__file__))

# Explicitly add this folder to sys.path if not already present
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

# --------------------------------------------------------------------------
import argparse
import ast
import re
from pathlib import Path
from typing import Any, Dict, List, Set

# ---- Reusable helpers ----------------------------------------------------
from utility_functions import (
    append_report,
    dump_json,
    git_changed_since,
    git_diff_files,
    git_head,
    load_json,
    now_iso,
    now_local_iso,
    parse_manifest_csv,
    run,
    touch_report,
    upsert_node,
)


def main_merge_auto(
    repo_name: str, repo_path: Path, tag: bool = False, tag_suffix: str | None = None
):
    repo = repo_path.resolve()
    print(
        f"\n[SkyOps] Starting post-release sync for '{repo_name}' — {now_local_iso()}"
    )

    # 1️⃣ Update local main
    print("\n→ Updating local 'main' branch from origin/main …")
    run(["git", "switch", "main"], repo)
    run(["git", "pull", "--ff-only"], repo)

    # 2️⃣ Optionally tag release
    if tag:
        tag_name = dt.datetime.now().strftime(f"v%Y.%m.%d{tag_suffix or ''}")
        msg = f"{repo_name} release"
        print(f"\n→ Tagging release {tag_name}")
        run(["git", "tag", "-a", tag_name, "-m", msg], repo)
        run(["git", "push", "--follow-tags"], repo)

    # 3️⃣ Update local dev
    print("\n→ Updating local 'dev' branch …")
    run(["git", "switch", "dev"], repo)
    run(["git", "pull", "--ff-only"], repo)

    # 4️⃣ Fast-forward dev from new main
    print("\n→ Fast-forwarding dev from origin/main …")
    run(["git", "merge", "--ff-only", "origin/main"], repo)

    print(f"\n✅ {repo_name} — post-release merge complete!\n")


def main():
    ap = argparse.ArgumentParser(description="Automate local Git post-release sync.")
    ap.add_argument("--name", required=True)
    ap.add_argument("--repo-path", required=True)
    ap.add_argument("--tag", action="store_true")
    ap.add_argument("--tag-suffix")
    args = ap.parse_args()

    main_merge_auto(
        args.name, Path(args.repo_path), tag=args.tag, tag_suffix=args.tag_suffix
    )


if __name__ == "__main__":
    main()
