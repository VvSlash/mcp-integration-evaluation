import os
import socket
import traceback

import bpy

LOG_FILE = r"datasets/.work/blender-bridge.log"
OWN_PORT = int(os.environ.get("MCP_EVAL_BLENDER_PORT", "9877"))

def _log(message: str) -> None:
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(message + "\n")
    except Exception:
        pass

def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.0):
            return True
    except Exception:
        return False

def _try_start():
    if hasattr(bpy.ops, "blendermcp"):
        try:
            bpy.ops.blendermcp.start_server()
            _log("BRIDGE_START_OK port=" + str(bpy.context.scene.blendermcp_port))
        except Exception:
            _log("BRIDGE_START_FAIL\n" + traceback.format_exc())
    else:
        _log("BRIDGE_THIRDPARTY_ABSENT (addon gotowca niezainstalowany - pomijam :9876)")
    return None

def _report_own_bridge():
    if _port_open(OWN_PORT):
        _log("OWN_BRIDGE_OK port=" + str(OWN_PORT))
    else:
        _log("OWN_BRIDGE_NOT_LISTENING port=" + str(OWN_PORT)
             + " (addon mcp_eval_addon wlaczony? zob. konsola Blendera)")
    return None

_log("BRIDGE_AUTOSTART_SCHEDULED own_port=" + str(OWN_PORT))
bpy.app.timers.register(_try_start, first_interval=2.0)
bpy.app.timers.register(_report_own_bridge, first_interval=5.0)
