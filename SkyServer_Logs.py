import os, json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Iterable, Any, Optional

# ==== Import SkyServer Functions ====
from SkyServer_Core import (  # type: ignore
    load_config,
    get_full_path,
    write_text_atomic,
    ensure_dir
)

# ─────────────────────────────────────────────────────────────
# SAVE & SUMMARY UTILITIES
# ─────────────────────────────────────────────────────────────
def detect_logs(config):
    monitored = config.get("logs_to_monitor", [])
    logs_dir = get_full_path(config, "")
    return [os.path.join(logs_dir, f) for f in monitored if os.path.exists(os.path.join(logs_dir, f))]

def save_summary_md(config, content, date_str):
    path = get_full_path(config, f"processed/{date_str}_summary.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"📄 Saved markdown summary: {path}")
    return path

def update_sky_log_index(config, log_file_path, log_type, entry_count, date_str, summary_file, aggregated_file):
    index_path = get_full_path(config, "index/SkyLogIndex.json")
    os.makedirs(os.path.dirname(index_path), exist_ok=True)
    try:
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                index = json.load(f)
        else:
            index = {}
        if date_str not in index:
            index[date_str] = {}
        index[date_str][os.path.basename(log_file_path)] = {
            "type": log_type,
            "entries": entry_count,
            "last_modified": datetime.now(ZoneInfo("America/Toronto")).isoformat(),
            "aggregated_file": aggregated_file,
            "summary_file": summary_file,
            "synced": False
        }
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2)
        print(f"✅ Updated SkyLogIndex for {date_str} → {log_type}")
    except Exception as e:
        print(f"❌ Failed to update SkyLogIndex: {e}")

# ──────────────────────────────────────────────────────────────────────
# Empty-aggregate guard
# ──────────────────────────────────────────────────────────────────────
def write_empty_aggregate_if_none(entries: Optional[Iterable[Any]], output_path: Path | str) -> bool:
    """
    Ensure an aggregate file exists even if there are no entries.

    If 'entries' is falsy, writes a minimal JSON '[]' for .json,
    or a small markdown stub for .md. Returns True if it wrote a stub,
    False if not needed or on failure.
    """
    try:
        p = Path(output_path)
        ensure_dir(p)
        has_entries = False
        if entries is not None:
            try:
                has_entries = len(list(entries)) > 0  # tolerate generators
            except Exception:
                # Fallback: try to iterate
                for _ in entries:  # type: ignore
                    has_entries = True
                    break
        if has_entries:
            return False

        if p.suffix.lower() == ".md":
            write_text_atomic(p, "# Aggregate (empty)\n")
        else:
            write_text_atomic(p, "[]")
        return True
    except Exception as e:
        print("[Core] write_empty_aggregate_if_none failed:", e)
        return False

# ════════════════════════════════════════════════════════════════════
# 💡 load_all_daily_aggregates | Load All Processed Logs by Date
# ────────────────────────────────────────────────────────────────────
# PURPOSE:    Collects all available aggregated logs for a given date.
# STRATEGY:   Scans /processed/ folder and loads files matching pattern.
# RETURNS:    Dictionary with keys like 'meal', 'workout', etc.
# ════════════════════════════════════════════════════════════════════
def load_all_daily_aggregates(date_str):
    base = "/processed/"
    suffixes = {
        "meal": f"aggregated_meal_{date_str}.json",
        "workout": f"aggregated_workout_{date_str}.json",
        "smartscale": f"aggregated_smartscale_{date_str}.json",
        "walk": f"aggregated_walk_{date_str}.json",
        "bagwork": f"aggregated_bagwork_{date_str}.json"
    }
    aggregates = {}
    for key, fname in suffixes.items():
        path = os.path.join(base, fname)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                aggregates[key] = json.load(f)
    return aggregates

# ════════════════════════════════════════════════════════════════════
# 💡 save_sky_daily_summary | Compile and Save Daily Summary
# ────────────────────────────────────────────────────────────────────
# PURPOSE:    Merges all daily aggregates into a unified report.
# STRATEGY:   Collects entries and totals into one JSON file.
# RETURNS:    Path to saved SkyDailySummary.json
# ════════════════════════════════════════════════════════════════════
def save_sky_daily_summary(date_str):
    data = load_all_daily_aggregates(date_str)
    result = {
        "date": date_str,
        "totals": {},
        "details": {}
    }
    for category, content in data.items():
        result["details"][category] = content
        result["totals"][category] = content.get("totals", {})

    output_path = f"./processed/SkyDailySummary_{date_str}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"📘 Saved SkyDailySummary: {output_path}")
    return output_path

# ─────────────────────────────────────────────────────────────
# EDUCATION LOGGING: Aggregation + Parsing
# ─────────────────────────────────────────────────────────────

def parse_sky_education_log(config, date_prefix=None):
    log_path = get_full_path(config, "SkyLog_Education.jsonl")
    entries = []
    if not os.path.exists(log_path):
        print("📭 No education log found.")
        return entries
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                if not date_prefix or entry["timestamp"].startswith(date_prefix):
                    entries.append(entry)
            except json.JSONDecodeError:
                continue
    print(f"📘 Loaded {len(entries)} education log entries.")
    return entries

def save_aggregated_education(config, date_str=None):
    if not date_str:
        date_str = datetime.now(ZoneInfo("America/Toronto")).strftime("%Y-%m-%d")
    log_path = get_full_path(config, "SkyLog_Education.jsonl")
    out_path = get_full_path(config, f"processed/aggregated_education_{date_str}.json")
    entries = []
    if not os.path.exists(log_path):
        print("📭 No education log found.")
        return None
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                if entry["timestamp"].startswith(date_str):
                    entries.append(entry)
            except json.JSONDecodeError:
                continue
    if not entries:
        print(f"📭 No education entries for {date_str}")
        return None
    output = {
        "date": date_str,
        "entry_count": len(entries),
        "entries": entries
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"📘 Aggregated education log saved: {out_path}")
    return out_path

# ╭──────────────────────────────────────────────────────────────────╮
# │ ⚖️ Smart Scale Log                                               │
# ╰──────────────────────────────────────────────────────────────────╯

def parse_sky_smartscale_log(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return [json.loads(line.strip()) for line in f if line.strip()]
    except:
        return []

def save_aggregated_smartscale(entries, date_str):
    filename = f"./processed/aggregated_smartscale_{date_str}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump({
            "date": date_str,
            "entries": entries
        }, f, indent=2)
    return filename

def summarize_smartscale(entries):
    if not entries:
        return {}

    latest = entries[-1]
    return {
        "timestamp": latest.get("timestamp"),
        "weight": latest.get("weight"),
        "muscle": latest.get("muscle"),
        "body_fat": latest.get("body_fat")
    }

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🏋️‍♂️ Workout Log                                                   │
# ╰──────────────────────────────────────────────────────────────────╯

def parse_sky_workout_log(filepath):
    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries

def save_aggregated_workout(entries, date_str):
    out = f"./processed/aggregated_workout_{date_str}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"date": date_str, "entries": entries, "totals": summarize_workout(entries)}, f, indent=2)
    print(f"🏋️ Workout summary saved: {out}")
    return out

def summarize_workout(entries):
    summary = {"total_sets": 0, "total_reps": 0, "groups": set(), "exercises": [], "core_sets": 0}
    for e in entries:
        for seg in e.get("segments", []):
            for ex in seg.get("exercises", []):
                sets, reps, group = ex.get("sets", 0), ex.get("reps", 0), ex.get("group", "").lower()
                summary["total_sets"] += sets
                summary["total_reps"] += sets * reps
                summary["groups"].add(group)
                summary["exercises"].append(ex.get("name", ""))
                if group == "core":
                    summary["core_sets"] += sets
    summary["groups"] = list(summary["groups"])
    return summary

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🍽️ Meal Log                                                      │
# ╰──────────────────────────────────────────────────────────────────╯

def parse_sky_meal_log(filepath):
    entries = []
    current = {}
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("[") and "]" in line:
                if current:
                    entries.append(current)
                timestamp = line.split("]")[0][1:]
                rest = line.split("]")[1].strip()
                if ":" in rest:
                    type_part, items = rest.split(":", 1)
                    meal_type = type_part.replace("🍽️", "").strip()
                    current = {
                        "timestamp": timestamp,
                        "type": meal_type,
                        "items": [i.strip() for i in items.split(",")],
                        "calories": 0,
                        "protein": 0,
                        "carbs": 0,
                        "fat": 0
                    }
            elif "Calories" in line:
                try:
                    current["calories"] = int(line.split("Calories:")[1].split("kcal")[0].strip())
                except:
                    pass
            elif any(macro in line for macro in ["Protein", "Carbs", "Fat"]):
                try:
                    parts = line.replace("g", "").split("|")
                    for part in parts:
                        key, val = part.strip().split(":")
                        key = key.strip().lower()
                        current[key] = int(val.strip())
                except:
                    pass
    if current:
        entries.append(current)
    
    return entries

def save_aggregated_meal(entries, date_str):
    result = {
        "date": date_str,
        "meals": entries,
        "totals": summarize_meals(entries)
    }
    os.makedirs("./processed/", exist_ok=True)
    filename = f"./processed/aggregated_meal_{date_str}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"🍽️ Aggregated meal data saved: {filename}")
    return filename

def summarize_meals(entries):
    totals = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}
    for e in entries:
        totals["calories"] += e.get("calories", 0)
        totals["protein"] += e.get("protein", 0)
        totals["carbs"] += e.get("carbs", 0)
        totals["fat"] += e.get("fat", 0)
    
    return totals

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🚶 Walk Log                                                       │
# ╰──────────────────────────────────────────────────────────────────╯

def parse_sky_walk_log(filepath):
    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                entry = json.loads(line)
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries

def save_aggregated_walk(entries, date_str):
    result = {
        "date": date_str,
        "entries": entries,
        "totals": summarize_walk_log(entries)
    }
    output_path = f"./processed/aggregated_walk_{date_str}.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"🚶 Aggregated walk data saved: {output_path}")
    return output_path

def summarize_walk_log(entries):
    summary = {
        "total_minutes": 0,
        "total_steps": 0,
        "total_distance_km": 0.0,
        "total_calories": 0
    }
    for entry in entries:
        summary["total_minutes"] += entry.get("duration_min", 0)
        summary["total_steps"] += entry.get("steps", 0)
        summary["total_distance_km"] += entry.get("distance_km", 0.0)
        summary["total_calories"] += entry.get("calories_burned", 0)
    return summary

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🥊 Bagwork Log                                                   │
# ╰──────────────────────────────────────────────────────────────────╯

def parse_sky_bagwork_log(filepath):
    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                entry = json.loads(line)
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries

def save_aggregated_bagwork(entries, date_str):
    result = {
        "date": date_str,
        "entries": entries,
        "totals": summarize_bagwork_log(entries)
    }
    output_path = f"./processed/aggregated_bagwork_{date_str}.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"🥊 Aggregated bagwork data saved: {output_path}")
    return output_path

def summarize_bagwork_log(entries):
    summary = {
        "total_rounds": 0,
        "total_rest_sec": 0,
        "rounds_by_intensity": {
            "light": 0,
            "moderate": 0,
            "intense": 0
        }
    }
    for entry in entries:
        summary["total_rounds"] += entry.get("rounds", 0)
        summary["total_rest_sec"] += entry.get("rest_sec", 0)
        effort = entry.get("effort_level", "moderate").lower()
        if effort in summary["rounds_by_intensity"]:
            summary["rounds_by_intensity"][effort] += entry.get("rounds", 0)
    return summary

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🥊 Sky Log Dispatcher                                            │
# ╰──────────────────────────────────────────────────────────────────╯

SkyLogDispatcher = {
    "meal": {"parser": parse_sky_meal_log, "summarizer": summarize_meals, "saver": save_aggregated_meal, "log_type": "meal"},
    "walk": {"parser": parse_sky_walk_log, "summarizer": summarize_walk_log, "saver": save_aggregated_walk, "log_type": "walk"},
    "bagwork": {"parser": parse_sky_bagwork_log, "summarizer": summarize_bagwork_log, "saver": save_aggregated_bagwork, "log_type": "bagwork"},
    "workout": {"parser": parse_sky_workout_log, "summarizer": summarize_workout, "saver": save_aggregated_workout, "log_type": "workout"},
    "smartscale": {"parser": parse_sky_smartscale_log, "summarizer": summarize_smartscale, "saver": save_aggregated_smartscale, "log_type": "smartscale"},
    "education": {"parser": parse_sky_education_log, "summarizer": None, "saver": save_aggregated_education, "log_type": "education"}
}

# ════════════════════════════════════════════════════════════════════
# 💡 process_log_via_dispatcher | Routed Log Aggregation & Summary
# ────────────────────────────────────────────────────────────────────
# PURPOSE:    Routes a single log file through SkyLogDispatcher to:
#             parse entries, aggregate data, optionally summarize, 
#             and update the SkyLogIndex.json metadata tracker.
#
# STRATEGY:   Matches filename with dispatcher key. Applies parser, 
#             saver, and summarizer (if defined) using dispatcher map.
#
# DEPENDS ON: dispatcher_map[]: must include parser, saver, and log_type
#             update_sky_log_index(), save_summary_md()
#
# RETURNS:    None. Writes aggregated and summary files and updates index.
#
# NOTES:      Called by aggregate_logs_task() or CLI-activated schedulers.
#             Dispatcher must have keys defined in lowercase filename match.
# ════════════════════════════════════════════════════════════════════
def process_log_via_dispatcher(config, log_file_path, dispatcher_map, date_str):
    print("📡 SkyServer v2.3 Dispatcher Activated", flush=True)
    basename = os.path.basename(log_file_path).lower()
    matched = False

    for key, ops in dispatcher_map.items():
        if key in basename:
            matched = True
            print(f"📥 Processing {key.title()} log...", flush=True)
            entries = ops["parser"](log_file_path)
            if not entries:
                print(f"⚠️ No valid entries in {key.title()} log.")
                return
            aggregated_file = ops["saver"](config, entries, date_str)
            summary_file = ""

            if callable(ops.get("summarizer")):
                summary = ops["summarizer"](entries)
                summary_file = save_summary_md(
                    config,
                    f"# {key.title()} Summary – {date_str}\n" + json.dumps(summary, indent=2),
                    date_str
                )

            update_sky_log_index(
                config,
                log_file_path,
                ops["log_type"],
                len(entries),
                date_str,
                summary_file,
                os.path.basename(aggregated_file)
            )
            return

    if not matched:
        print(f"⚠️ No dispatcher match found for: {basename}", flush=True)

# ╭──────────────────────────────────────────────────────────────────╮
# │ 🥊 SkyScheduler Tasks                                            │
# ╰──────────────────────────────────────────────────────────────────╯

# ════════════════════════════════════════════════════════════════════
# 💡 aggregate_logs_task | Log Aggregation via SkyDispatcher
# ────────────────────────────────────────────────────────────────────
# PURPOSE:     Aggregates all eligible SkyLogs for the current date
#              by parsing, saving entries, and indexing log metadata.
#
# STRATEGY:    Leverages SkyLogDispatcher to route each log type to
#              its corresponding parser/saver pair. Updates SkyLogIndex
#              using dispatcher-defined log_type and filenames.
#
# DEPENDS ON:  SkyLogDispatcher[], config.json, parse_* + save_*
#              functions defined in SkyServer.py or SkyNP_Logs module.
#
# NOTES:       This is part of the SkyScheduler system and may be
#              scheduled via CLI, cron, or Windows Task Scheduler.
#              Runs independently of summary logic.
# ════════════════════════════════════════════════════════════════════
def aggregate_logs_task():
    print("📡 Started aggregate_logs_task()", flush=True)
    config = load_config()
    logs = detect_logs(config)
    date_str = datetime.now(ZoneInfo("America/Toronto")).strftime("%Y-%m-%d")
    
    for log_file in logs:
        process_log_via_dispatcher(config, log_file, SkyLogDispatcher, date_str)
        print(f"🔍 Dispatching log: {log_file}", flush=True)

    print("✅ aggregate_logs_task() completed.", flush=True)

# ════════════════════════════════════════════════════════════════════
# 💡 summarize_logs_task | Post-Aggregation Markdown + Index Sync
# ────────────────────────────────────────────────────────────────────
# PURPOSE:    Generates unified markdown summary from all active
#              logs using dispatcher metadata and summary handlers.
# STRATEGY:   Iterates through dispatcher to load summaries
#              and render fragments into clean markdown file.
# DEPENDS:    dispatcher["summarizer"] must exist
# ════════════════════════════════════════════════════════════════════
def summarize_logs_task():
    now = datetime.now(ZoneInfo("America/Toronto"))
    date_str = now.strftime("%Y-%m-%d")
    index_file = "./index/SkyLogIndex.json"
    summary_fragments = []

    try:
        with open(index_file, "r", encoding="utf-8") as f:
            index = json.load(f)

        day_logs = index.get(date_str, {})

        for log_file, meta in day_logs.items():
            log_type = meta.get("type")
            agg_file = meta.get("aggregated_file")

            dispatcher = SkyLogDispatcher.get(log_type, {})
            summarizer = dispatcher.get("summarizer")

            if not summarizer or not agg_file:
                continue

            agg_path = os.path.join("./processed/", agg_file)
            if not os.path.exists(agg_path):
                continue

            with open(agg_path, "r", encoding="utf-8") as af:
                content = json.load(af)

            summary = summarizer(content.get("entries", []))
            fragment = f"🔹 **{log_type.capitalize()}** – {json.dumps(summary, indent=0)}"
            summary_fragments.append(fragment)

        if summary_fragments:
            md = "# SkyNP Summary – " + date_str + "\n" + "\n".join(summary_fragments)
            path = save_summary_md(md, date_str)
            print(f"✅ Summary written to: {path}", flush=True)
        else:
            print("⚠️ No summary fragments generated.")

    except Exception as e:
        print(f"❌ Error during summarization: {e}", flush=True)