#!/usr/bin/env python3
"""
Sky Delta Update — refresh RepoMap and (for SkyOne) CommandHandlers incrementally.

USAGE EXAMPLES:
  # SkyOps (repo map only)
  python tools/Python/Git_Repo_Docs/dev_commit_docs.py \
    --name SkyOps \
    --repo-path . \
    --repomap RepoMap_SkyOps.json \
    --report DeltaReport.md
"""
from __future__ import annotations

import argparse
import ast
import csv
import datetime as dt
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Set

try:
    # Python 3.9+
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


def ensure_local_imports():
    """
    Guarantee that this file's directory is always importable.
    Adds the 'Git_Repo_Docs' folder to sys.path when missing.
    Use this at the top of any script that imports from this module.
    """
    module_dir = os.path.dirname(os.path.abspath(__file__))
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)
        print(f"[import-resolver] Added module path: {module_dir}")


# ----------------- utilities -----------------
def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def run(cmd: List[str], cwd: Path) -> str:
    p = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{p.stderr}")
    return p.stdout.strip()


def git_head(repo: Path) -> str:
    return run(["git", "rev-parse", "HEAD"], repo)


def git_changed_since(repo: Path, since_sha: str | None) -> Set[Path]:
    if not since_sha:
        out = run(["git", "ls-files"], repo)
    else:
        out = run(["git", "diff", "--name-only", f"{since_sha}..HEAD"], repo)
    return {Path(p) for p in out.splitlines() if p.strip()}


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data: Dict[str, Any]) -> None:
    """Write a dictionary to JSON, ensuring parent directory exists and the file is fully flushed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = json.dumps(data, indent=2)
    with open(path, "w", encoding="utf-8") as f:
        f.write(temp)
        f.flush()  # push Python’s buffer
        os.fsync(f.fileno())  # force the OS to commit the data
    # ensure mtime is updated before returning
    path.touch()


def touch_report(report_path: Path) -> None:
    """Create a markdown report file if it does not exist."""
    if not report_path.exists():
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("# Delta Report\n\n", encoding="utf-8")


def append_report(report_path: Path, text: str) -> None:
    """Append text to the report file and flush to disk."""
    with open(report_path, "a", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    # refresh mtime to signal new content
    report_path.touch()


def git_diff_files(repo: Path, base: str, head: str) -> list[Path]:
    """Return list of relative paths changed between two refs."""
    out = run(["git", "diff", "--name-only", f"{base}..{head}"], repo)
    return [Path(p) for p in out.splitlines() if p.strip()]


def now_local_iso(tz_name: str = "America/Toronto") -> str:
    """
    Return local timestamp in the requested timezone, with DST handled.
    Example: 2025-10-17T02:14:07-04:00 (America/Toronto, EDT)
    Falls back to system local if the IANA tz is unavailable.
    """
    now_utc = datetime.now(timezone.utc)
    local = None
    label_tz = tz_name
    try:
        if ZoneInfo is not None:
            local = now_utc.astimezone(ZoneInfo(tz_name))
        else:
            raise Exception("ZoneInfo unavailable")
    except Exception:
        # Fallback: use system-local time (still DST-aware)
        local = now_utc.astimezone()
        label_tz = local.tzname() or "local"

    local = local.replace(microsecond=0)
    # isoformat() already includes the numeric offset like -04:00 / -05:00
    return f"{local.isoformat()} ({label_tz}, {local.tzname() or ''})"


# ----------------- SkyOne manifest (unchanged) -----------------
def parse_manifest_csv(csv_path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(
                {
                    "alias": r.get("Alias", "").strip(),
                    "handler": r.get("CommandName", "").strip()
                    or r.get("Handler", "").strip(),
                    "module": r.get("Module", "").strip(),
                    "execution_type": (
                        r.get("ExecutionType", "").strip() or "function"
                    ),
                    "parameters": [
                        p.strip()
                        for p in (r.get("Parameters", "").split(","))
                        if p.strip()
                    ],
                    "notes": r.get("Detail", "").strip(),
                }
            )
    return rows


# ----------------- analyzers -----------------
TEXT_EXTS = {".md", ".yml", ".yaml", ".ps1", ".txt", ""}  # "" captures Makefile


def analyze_py(py_path: Path, repo_path: Path) -> Dict[str, Any]:
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


def upsert_node(nodes: List[Dict[str, Any]], new_node: Dict[str, Any]) -> None:
    for i, n in enumerate(nodes):
        if n.get("path") == new_node.get("path"):
            nodes[i] = new_node
            return
    nodes.append(new_node)


# ----------------- map updaters -----------------
def delta_update_repomap(
    repo_name: str, repo_path: Path, repomap_path: Path, changed: Set[Path]
) -> Dict[str, Any]:
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
            # deletion
            nodes[:] = [n for n in nodes if n.get("path") != str(rel.as_posix())]
            continue
        if rel.suffix == ".py":
            upsert_node(nodes, analyze_py(abs_path, repo_path))
        elif rel.suffix in TEXT_EXTS or rel.name.lower() == "makefile":
            upsert_node(nodes, analyze_text(abs_path, repo_path))
        else:
            continue

    repomap["scanned_at"] = now_iso()
    repomap["commit"] = git_head(repo_path)
    dump_json(repomap_path, repomap)
    return repomap


def delta_update_handlers(csv_path: Path, handlers_path: Path) -> Dict[str, Any]:
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

    # Ensure we have current remote refs (for dev vs main section)
    try:
        run(["git", "fetch", "origin", "--quiet"], repo)
    except Exception:
        pass  # offline is fine; we'll just skip dev vs main if missing

    # --- Read previous map BEFORE resetting, so prev_commit is real ---
    prev_commit = None
    if repomap_path.exists():
        existing = load_json(repomap_path)
        prev_commit = existing.get("commit") if existing else None

    # --- Reset report & map files ---
    if report_path.exists():
        report_path.unlink()
    if repomap_path.exists():
        repomap_path.unlink()

    report_path.parent.mkdir(parents=True, exist_ok=True)
    header = f"# Delta Report — {args.name}\n\n"
    report_path.write_text(header, encoding="utf-8")

    head = git_head(repo)
    append_report(report_path, f"## {args.name} — {now_local_iso(args.tz)}\n")
    append_report(
        report_path,
        f"- Previous commit: `{prev_commit or 'None'}`\n- Current head: `{head}`\n",
    )

    # --- (A) Dev vs previous dev commit (the canonical per-run delta) ---
    changed_prev = git_changed_since(repo, prev_commit)
    append_report(report_path, "\n### Δ dev vs previous dev commit\n")
    if changed_prev:
        for rel in sorted(changed_prev):
            append_report(report_path, f"  - {rel}\n")
    else:
        append_report(report_path, "  (no changes since previous dev commit)\n")

    # --- (B) Dev vs main (origin/main..HEAD) ---
    append_report(report_path, "\n### Δ dev vs main (origin/main..HEAD)\n")
    dev_vs_main = []
    try:
        dev_vs_main = git_diff_files(repo, "origin/main", "HEAD")
    except Exception:
        pass
    if dev_vs_main:
        for rel in sorted(dev_vs_main):
            append_report(report_path, f"  - {rel}\n")
    else:
        append_report(report_path, "  (no differences or main not available)\n")

    # --- Always rebuild a FULL RepoMap (complete snapshot) ---
    all_files = {
        Path(p) for p in run(["git", "ls-files"], repo).splitlines() if p.strip()
    }
    repomap = delta_update_repomap(args.name, repo, repomap_path, all_files)
    append_report(
        report_path, f"\n- Repo map updated. nodes={len(repomap.get('nodes', []))}\n"
    )

    # --- Optional SkyOne handlers refresh (unchanged behavior) ---
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
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
