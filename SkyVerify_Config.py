import sys, json, os, pathlib
sys.path.insert(0, r"C:\Users\Anima\Dropbox\Sky&P File Archive\Python Programming\SkyServer System\1SkyServer")
import SkyServer_Core as core  # type: ignore
cfg = core.load_config()
print("Resolved base_path:", cfg.get("base_path"))
print("SIM_MODE:", cfg.get("SIM_MODE"))
print("Heartbeat path:", cfg.get("heartbeat_log"))

