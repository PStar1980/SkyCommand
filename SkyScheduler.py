import sys, os, json, time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path as _P

# Try python-dotenv first; fallback to a minimal loader if missing
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None

# ==== Import SkyServer_Core Functions ====
from SkyServer_Core import (  # type: ignore
    load_config,
    load_env_file,
    write_heartbeat
)

# ==== Import SkyServer_Logs Functions ====
from SkyServer_Logs import (  # type: ignore
    aggregate_logs_task,
    summarize_logs_task
)

# Auto-load .env for local portability
try:
    dotenv_path = _P(__file__).with_name(".env")
    if load_dotenv is not None:
        load_dotenv(dotenv_path=dotenv_path)
    else:
        load_env_file(dotenv_path)
except Exception as e:
    print(f"[SkyScheduler] .env load failed: {e}")


# ==== SkyScheduler Entrypoint ====
# ════════════════════════════════════════════════════════════════════
# 💡 run_scheduler | Central Scheduler for Daily SkyNP Log Rituals
# ────────────────────────────────────────────────────────────────────
# PURPOSE:    Orchestrates aggregation and summarization tasks based on
#             current date and configuration. Also writes a heartbeat.
# ════════════════════════════════════════════════════════════════════

def run_scheduler(scheduled_task=None):
    now = datetime.now(ZoneInfo("America/Toronto"))
    date_str = now.strftime("%Y-%m-%d")
    _cfg = load_config()
    _hb = _cfg.get("heartbeat_log", "./SkyServer_Heartbeat.log")
    write_heartbeat(_hb)

    try:
        print("✅ Started run_scheduler()", flush=True)

        if scheduled_task == "aggregate_logs_task":
            aggregate_logs_task()
            print("✅ run_scheduler- aggregate_logs_task completed.", flush=True)
        elif scheduled_task == "summarize_logs_task":
            summarize_logs_task()
            print("✅ run_scheduler - summarize_logs_task completed.", flush=True)

        print("✅ Completed run_scheduler()", flush=True)

    except Exception as e:
        print(f"❌ Exception: {e}", flush=True)

if __name__ == "__main__":
    task_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run_scheduler(task_arg)
