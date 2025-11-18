#!/usr/bin/env python3
"""
Sky Delta Update — refresh RepoMap and (for SkyOne) CommandHandlers incrementally.

USAGE EXAMPLE:
  python tools/Python/Git_Repo_Docs/dev_commit_auto.py \
    --name SkyOps \
    --repo-path . \
    --repomap RepoMap_SkyOps.json \
    --report DeltaReport.md
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

# ----------------- analyzers -----------------
TEXT_EXTS = {".md", ".yml", ".yaml", ".ps1", ".txt", ""}  # "" captures Makefile


def analyze_py(py_path: Path, repo_path: Path) -> Dict[str, Any]:
    """Analyze Python file for functions, imports, and references."""
    src = py_path.read_text(encoding="utf-8", errors="ignore")
    tree = ast.parse(src)
    fns = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]

    imps = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imps += [a.name.split(".")[0] for a in n.names]
        if isinstance(n, ast.ImportFrom) and n.module:
            imps.append(n.module.split(".")[0])
    imps = sorted(set(imps))

    reads = sorted(set(re.findall(r"\"(/mnt/[^\"']+)\"", src)))
    writes = sorted(set(re.findall(r"\"(/mnt/[^\"']+)\"", src)))

    summary = "Python module"
    name = py_path.name.lower()
    if "schedule" in name:
        summary = "Scheduler / rituals"
    if "core" in name:
        summary = "Core utilities"
    if "log" in name:
        summary = "Logging utilities"

    return {
        "path": str(py_path.relative_to(repo_path).as_posix()),
        "type": "file",
        "summary": summary,
        "exports": fns[:20],
        "imports": imps[:20],
        "reads": reads[:20],
        "writes": writes[:20],
        "notes": [],
    }


def analyze_text(path: Path, repo_path: Path) -> Dict[str, Any]:
    """Analyze non-Python text/config files."""
    name = path.name.lower()
    summary = "Text/Config"
    if name == "makefile":
        summary = "Makefile targets"
    if name.endswith((".yml", ".yaml")):
        summary = "CI/Workflow or configuration"
    if name.endswith(".md"):
        summary = "Markdown documentation"
    if name.endswith(".ps1"):
        summary = "PowerShell script"
    return {
        "path": str(path.relative_to(repo_path).as_posix()),
        "type": "file",
        "summary": summary,
        "exports": [],
        "imports": [],
        "reads": [],
        "writes": [],
        "notes": [],
    }


# ----------------- map updaters -----------------
def delta_update_repomap(
    repo_name: str, repo_path: Path, repomap_path: Path, changed: Set[Path]
) -> Dict[str, Any]:
    """Rebuild RepoMap snapshot."""
    repomap = load_json(repomap_path) or {
        "repo": repo_name,
        "commit": None,
        "scanned_at": None,
        "nodes": [],
        "artifacts": [],
    }
    nodes = repomap.setdefault("nodes", [])

    for rel in sorted(changed):
        abs_path = repo_path / rel
        if not abs_path.exists():
            nodes[:] = [n for n in nodes if n.get("path") != str(rel.as_posix())]
            continue
        if rel.suffix == ".py":
            upsert_node(nodes, analyze_py(abs_path, repo_path))
        elif rel.suffix in TEXT_EXTS or rel.name.lower() == "makefile":
            upsert_node(nodes, analyze_text(abs_path, repo_path))

    repomap["scanned_at"] = now_iso()
    repomap["commit"] = git_head(repo_path)
    dump_json(repomap_path, repomap)
    return repomap


def delta_update_handlers(csv_path: Path, handlers_path: Path) -> Dict[str, Any]:
    """Regenerate SkyOne command handlers from manifest CSV."""
    handlers = parse_manifest_csv(csv_path)
    data = {
        "source": {"path": csv_path.name, "commit": None, "row_count": len(handlers)},
        "handlers": handlers,
        "extraction": {"generated_at": now_iso(), "method": "delta", "warnings": []},
    }
    dump_json(handlers_path, data)
    return data


# ----------------- CLI -----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--repo-path", required=True)
    ap.add_argument("--repomap", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--handlers")
    ap.add_argument("--manifest", default="SkyNP_Boot_Manifest.csv")
    ap.add_argument(
        "--tz",
        default="America/Toronto",
        help="IANA timezone for report timestamps (default: America/Toronto)",
    )
    args = ap.parse_args()

    repo = Path(args.repo_path).resolve()
    repomap_path = Path(args.repomap).resolve()
    report_path = Path(args.report).resolve()
    handlers_path = Path(args.handlers).resolve() if args.handlers else None

    try:
        run(["git", "fetch", "origin", "--quiet"], repo)
    except Exception:
        pass

    prev_commit = None
    if repomap_path.exists():
        existing = load_json(repomap_path)
        prev_commit = existing.get("commit") if existing else None

    if report_path.exists():
        report_path.unlink()
    if repomap_path.exists():
        repomap_path.unlink()

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(f"# Delta Report — {args.name}\n\n", encoding="utf-8")

    head = git_head(repo)
    append_report(report_path, f"## {args.name} — {now_local_iso(args.tz)}\n")
    append_report(
        report_path,
        f"- Previous commit: `{prev_commit or 'None'}`\n- Current head: `{head}`\n",
    )

    # (A) dev vs previous commit
    changed_prev = git_changed_since(repo, prev_commit)
    append_report(report_path, "\n### Δ dev vs previous dev commit\n")
    if changed_prev:
        for rel in sorted(changed_prev):
            append_report(report_path, f"  - {rel}\n")
    else:
        append_report(report_path, "  (no changes since previous dev commit)\n")

    # (B) dev vs main
    append_report(report_path, "\n### Δ dev vs main (origin/main..HEAD)\n")
    try:
        dev_vs_main = git_diff_files(repo, "origin/main", "HEAD")
    except Exception:
        dev_vs_main = []
    if dev_vs_main:
        for rel in sorted(dev_vs_main):
            append_report(report_path, f"  - {rel}\n")
    else:
        append_report(report_path, "  (no differences or main not available)\n")

    # (C) Full RepoMap rebuild
    all_files = {
        Path(p) for p in run(["git", "ls-files"], repo).splitlines() if p.strip()
    }
    repomap = delta_update_repomap(args.name, repo, repomap_path, all_files)
    append_report(
        report_path, f"\n- Repo map updated. nodes={len(repomap.get('nodes', []))}\n"
    )

    # (D) Optional handlers refresh
    if args.name.lower() == "skyone" and handlers_path:
        manifest_rel = Path(args.manifest)
        csv_path = repo / manifest_rel
        if csv_path.exists():
            handlers = delta_update_handlers(csv_path, handlers_path)
            append_report(
                report_path,
                f"- CommandHandlers refreshed from `{manifest_rel}` rows={handlers['source']['row_count']}\n",
            )

    print(f"Delta complete. RepoMap saved to {repomap_path}, Report: {report_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e)
        raise
