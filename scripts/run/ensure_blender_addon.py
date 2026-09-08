import sys
from pathlib import Path

import bpy

separator = sys.argv.index("--")
addon_paths = sys.argv[separator + 1:]
if not addon_paths:
    raise SystemExit("Brak sciezek addonow po separatorze --")

for addon_path in addon_paths:
    module = Path(addon_path).stem
    bpy.ops.preferences.addon_install(overwrite=True, filepath=addon_path)
    bpy.ops.preferences.addon_enable(module=module)
    print("ADDON_OK %s" % module)

bpy.ops.wm.save_userpref()
