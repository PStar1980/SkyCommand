# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘  SkyServer_Core.py                                                    â•‘
# â•‘  Core utilities shared by SkyServer, SkyScheduler, and SkyServer_Logs â•‘
# â•‘  - No circular imports (this module imports nothing from others)      â•‘
# â•‘  - Safe config loading (absolute path + .env + env overrides)         â•‘
# â•‘  - Path helpers, atomic writers, JSONL helpers                        â•‘
# â•‘  - Date/time helpers & heartbeat                                      â•‘
# â•‘  - Optional: log detection & empty-aggregate guard                    â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
from __future__ import annotations
import os
import json
import time
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from typing import Iterable, List, Dict, Any, Optional

__all__ = [
    "load_config",
    "_load_env_file",           # optional to export; include only if you want external access
    "ensure_dir",
    "get_full_path",
    "write_text_atomic",
    "write_json_atomic",
    "read_jsonl",
    "append_jsonl",
    "today_key",
    "coerce_timestamp",
    "write_heartbeat",
    "detect_logs",
    "write_empty_aggregate_if_none",
]

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# .env support (minimal loader)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _load_env_file(dotenv_path: Path) -> None:
    """
    Minimal .env loader: reads KEY=VALUE lines, ignores comments/blank lines.
    Does not overwrite already-set environment variables.
    """
    try:
        if not dotenv_path.exists():
            return
        for line in dotenv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and (k not in os.environ or not os.environ[k]):
                    os.environ[k] = v
    except Exception as e:
        print("[Core] .env load skipped:", e)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Secrets & masking
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _mask_secret(value: Optional[str]) -> Optional[str]:
    """Mask API keys/tokens for safe logging/printing."""
    if not value or not isinstance(value, str):
        return value
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}â€¦{value[-4:]}"


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Config loading
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def load_config() -> Dict[str, Any]:
    """
    Load SkyServer configuration:
      1) Read 'config.json' from the same directory as this file (absolute path).
      2) Auto-load a local '.env' file in the same directory (if present).
      3) Apply environment variable overrides:
         - OPENAI_API_KEY â†’ config["openai_api_key"]
         - SKYSERVER_BASE_PATH â†’ config["base_path"]
      4) Normalize:
         - SIM_MODE â†’ bool (default True if missing)
         - base_path â†’ absolute, expanded, resolved
         - model remains as provided (caller decides default)
    Returns: dict configuration
    """
    here = Path(__file__).parent
    dotenv_path = here / ".env"
    _load_env_file(dotenv_path)

    # Absolute config path next to this file
    config_path = here / "config.json"
    if not config_path.exists():
        raise FileNotFoundError(f"[Core] config.json not found at {config_path}")

    try:
        config = json.loads(config_path.read_text(encoding="utf-8", errors="ignore"))
    except Exception as e:
        raise RuntimeError(f"[Core] Failed to parse config.json: {e}")

    # Env overrides
    env_api = os.getenv("OPENAI_API_KEY")
    if env_api:
        config["openai_api_key"] = env_api

    env_base = os.getenv("SKYSERVER_BASE_PATH")
    if env_base:
        config["base_path"] = env_base

    # Normalization
    config["SIM_MODE"] = bool(config.get("SIM_MODE", True))
    if "base_path" in config and isinstance(config["base_path"], str):
        try:
            config["base_path"] = str(Path(config["base_path"]).expanduser().resolve())
        except Exception:
            # Leave as-is if resolution fails
            pass

    return config


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Path helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def ensure_dir(path: Path | str) -> None:
    """Ensure the parent directory for 'path' exists."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)


def get_full_path(config: Dict[str, Any], *parts: str) -> str:
    """
    Join provided path parts under config['base_path'] and return string path.
    """
    base = Path(config.get("base_path", "."))
    return str((base.joinpath(*parts)).expanduser().resolve())


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Atomic writers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def write_text_atomic(path: Path | str, text: str) -> None:
    """Write text atomically to avoid partial files."""
    path = Path(path)
    ensure_dir(path)
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
        tmp.write(text)
        tmp_path = Path(tmp.name)
    shutil.move(str(tmp_path), str(path))


def write_json_atomic(path: Path | str, obj: Any) -> None:
    """Write JSON atomically with UTF-8 encoding and indentation."""
    path = Path(path)
    ensure_dir(path)
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
        json.dump(obj, tmp, indent=2, ensure_ascii=False)
        tmp_path = Path(tmp.name)
    shutil.move(str(tmp_path), str(path))


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# JSONL helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def read_jsonl(path: Path | str) -> List[Dict[str, Any]]:
    """
    Read a JSONL file into a list of dicts. Non-dict lines are skipped.
    Missing file returns an empty list.
    """
    p = Path(path)
    if not p.exists():
        return []
    items: List[Dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                items.append(obj)
        except Exception:
            # Skip invalid lines
            continue
    return items


def append_jsonl(path: Path | str, records: Iterable[Dict[str, Any]]) -> None:
    """
    Append iterable of dict records to a JSONL file. Creates file if missing.
    """
    p = Path(path)
    ensure_dir(p)
    with p.open("a", encoding="utf-8") as f:
        for rec in records:
            try:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            except Exception:
                # Skip invalid records rather than breaking the whole write
                continue


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Date/time helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def today_key(dt: Optional[datetime] = None) -> str:
    """Return YYYYMMDD for the provided datetime (or now)."""
    d = dt or datetime.now()
    return d.strftime("%Y%m%d")


def coerce_timestamp(date_str: Optional[str], fallback_path: Optional[str]) -> str:
    """
    Return an ISO timestamp. If date_str provided (YYYY-MM-DD or YYYYMMDD),
    produce midnight ISO for that date; otherwise, use file mtime if available;
    else fallback to current time.
    """
    if date_str:
        s = date_str.strip()
        try:
            if "-" in s:
                d = datetime.strptime(s, "%Y-%m-%d")
            else:
                d = datetime.strptime(s, "%Y%m%d")
            return d.isoformat()
        except Exception:
            pass  # fall through

    if fallback_path and Path(fallback_path).exists():
        ts = Path(fallback_path).stat().st_mtime
        return datetime.fromtimestamp(ts).isoformat()

    return datetime.now().isoformat()


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Heartbeat
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def write_heartbeat(path: Path | str) -> None:
    """Append a single line heartbeat with ISO timestamp."""
    p = Path(path)
    ensure_dir(p)
    try:
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat()} | heartbeat ok\n")
    except Exception as e:
        print("[Core] Heartbeat write failed:", e)
