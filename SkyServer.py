import os, json, time, sys
from pathlib import Path as _P
from datetime import datetime
from zoneinfo import ZoneInfo

# ==== Import SkyScheduler Functions ====
from SkyScheduler import (  # type: ignore
    run_scheduler
)

# ==== Import SkyServer_Core Functions ====
from SkyServer_Core import (  # type: ignore
    _load_env_file,
    load_config,
    write_heartbeat
)

# Auto-load .env located next to this file
try:
    _here = _P(__file__).parent
    _env = _here / ".env"
    _load_env_file(_env)
except Exception as _e:
    print("[dotenv] auto-load failed:", _e)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# MAIN FUNCTION (Entry point for SkyServer Execution)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def main(scheduled_task=None):
    now = datetime.now(ZoneInfo("America/Toronto"))
    date_str = now.strftime("%Y-%m-%d")
    _cfg = load_config()
    _hb = _cfg.get("heartbeat_log", "./SkyServer_Heartbeat.log")
    write_heartbeat(_hb)

    try:
        print("âœ… Started main()", flush=True)

        if scheduled_task == "aggregate_logs_task":
            run_scheduler(scheduled_task)
            print("âœ… main - aggregate_logs_task completed.", flush=True)
        elif scheduled_task == "summarize_logs_task":
            run_scheduler(scheduled_task)
            print("âœ… main - summarize_logs_task completed.", flush=True)

        print("âœ… Completed main()", flush=True)

    except Exception as e:
        print(f"âŒ Exception: {e}", flush=True)

if __name__ == "__main__":
    task_arg = sys.argv[1] if len(sys.argv) > 1 else None
    main(task_arg)
