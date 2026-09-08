

import json
import os
import socket
import threading
import traceback

import bpy
from mathutils import Vector

bl_info = {
    "name": "MCP Eval Bridge (own Blender MCP server)",
    "author": "mcp-integration-evaluation",
    "version": (0, 1, 0),
    "blender": (4, 5, 0),
    "location": "Headless TCP bridge (no UI)",
    "description": "Minimal TCP bridge (NDJSON, port 9877) for the project's own Blender MCP server",
    "category": "Development",
}

DEFAULT_PORT = 9877
HOST = "127.0.0.1"

class BridgeOpError(Exception):

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message

def _hex_to_rgb(value):
    value = str(value).lstrip("#")
    if len(value) != 6:
        raise BridgeOpError("INVALID_COLOR_HEX", "colorHex must look like #RRGGBB, got: %r" % value)
    try:
        return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        raise BridgeOpError("INVALID_COLOR_HEX", "colorHex must look like #RRGGBB, got: %r" % value)

def _rgb_to_hex(rgba):
    return "#%02X%02X%02X" % tuple(max(0, min(255, round(channel * 255))) for channel in tuple(rgba)[:3])

def _point_at(obj, target):
    direction = Vector(target) - obj.location
    if direction.length == 0:
        return
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

def _material_base_color_hex(material):
    if material is None:
        return None
    if material.use_nodes:
        node = material.node_tree.nodes.get("Principled BSDF")
        if node is not None:
            return _rgb_to_hex(node.inputs["Base Color"].default_value)
    return _rgb_to_hex(material.diffuse_color)

def op_ping(params):
    return {
        "pong": True,
        "blenderVersion": bpy.app.version_string,
        "addonVersion": ".".join(str(part) for part in bl_info["version"]),
    }

def op_get_scene_summary(params):

    scene = bpy.context.scene
    objects = []
    for obj in scene.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "location": [round(value, 4) for value in obj.location],
            "dimensions": [round(value, 4) for value in obj.dimensions],
        }
        if obj.type == "MESH" and obj.data.materials and obj.data.materials[0] is not None:
            material = obj.data.materials[0]
            entry["material"] = {
                "name": material.name,
                "baseColorHex": _material_base_color_hex(material),
            }
        if obj.type == "CAMERA":
            direction = obj.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
            entry["viewDirection"] = [round(value, 4) for value in direction]
        objects.append(entry)
    return {
        "count": len(objects),
        "activeCamera": scene.camera.name if scene.camera is not None else None,
        "objects": objects,
    }

def op_reset_scene(params):

    mode = str(params.get("mode", "default"))
    if mode not in ("default", "empty"):
        raise BridgeOpError("INVALID_RESET_MODE", "mode must be 'default' or 'empty', got: %r" % mode)

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)

    if mode == "default":
        bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0.0, 0.0, 0.0))
        bpy.context.active_object.name = "Cube"
        light_data = bpy.data.lights.new("Light", type="POINT")
        light_data.energy = 1000.0
        light_obj = bpy.data.objects.new("Light", light_data)
        light_obj.location = (4.0762, 1.0055, 5.9039)
        bpy.context.collection.objects.link(light_obj)
        camera_data = bpy.data.cameras.new("Camera")
        camera_obj = bpy.data.objects.new("Camera", camera_data)
        camera_obj.location = (7.3589, -6.9258, 4.9583)
        bpy.context.collection.objects.link(camera_obj)
        _point_at(camera_obj, (0.0, 0.0, 0.0))
        bpy.context.scene.camera = camera_obj

    return op_get_scene_summary({})

def op_create_cube(params):
    size = float(params.get("size", 2.0))
    location = tuple(params.get("location", (0.0, 0.0, 0.0)))
    bpy.ops.mesh.primitive_cube_add(size=size, location=location)
    obj = bpy.context.active_object
    if params.get("name"):
        obj.name = str(params["name"])
    return {"name": obj.name, "type": obj.type, "size": size, "location": [round(v, 4) for v in obj.location]}

def op_create_sphere(params):
    radius = float(params.get("radius", 1.0))
    location = tuple(params.get("location", (0.0, 0.0, 0.0)))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location)
    obj = bpy.context.active_object
    if params.get("name"):
        obj.name = str(params["name"])
    return {"name": obj.name, "type": obj.type, "radius": radius, "location": [round(v, 4) for v in obj.location]}

def op_set_material(params):
    object_name = str(params.get("object", ""))
    target = bpy.data.objects.get(object_name)
    if target is None:
        raise BridgeOpError("OBJECT_NOT_FOUND", "No object named %r in the scene." % object_name)
    if not hasattr(target.data, "materials"):
        raise BridgeOpError(
            "OBJECT_HAS_NO_MATERIAL_SLOTS",
            "Object %r (%s) does not accept materials." % (object_name, target.type),
        )

    color_hex = str(params.get("colorHex", "#FFFFFF"))
    rgb = _hex_to_rgb(color_hex)
    material = bpy.data.materials.new(name="%sMaterial" % target.name)
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    if node is not None:
        node.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        if "metallic" in params:
            node.inputs["Metallic"].default_value = float(params["metallic"])
        if "roughness" in params:
            node.inputs["Roughness"].default_value = float(params["roughness"])
    material.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)

    if target.data.materials:
        target.data.materials[0] = material
    else:
        target.data.materials.append(material)
    return {"object": target.name, "material": material.name, "colorHex": color_hex.upper()}

def op_set_camera(params):
    location = tuple(params["location"])
    look_at = tuple(params["lookAt"])
    camera_obj = bpy.context.scene.camera
    if camera_obj is None or camera_obj.type != "CAMERA":
        camera_obj = next((obj for obj in bpy.context.scene.objects if obj.type == "CAMERA"), None)
    if camera_obj is None:
        camera_data = bpy.data.cameras.new("Camera")
        camera_obj = bpy.data.objects.new("Camera", camera_data)
        bpy.context.collection.objects.link(camera_obj)
    camera_obj.location = location
    _point_at(camera_obj, look_at)
    bpy.context.scene.camera = camera_obj
    return {
        "name": camera_obj.name,
        "location": [round(v, 4) for v in camera_obj.location],
        "lookAt": [round(float(v), 4) for v in look_at],
    }

def op_render_preview(params):
    output_path = os.path.abspath(str(params["outputPath"]))
    scene = bpy.context.scene
    if scene.camera is None:
        raise BridgeOpError("NO_ACTIVE_CAMERA", "Scene has no active camera - call blender_set_camera first.")
    scene.render.resolution_x = int(params.get("resolutionX", 320))
    scene.render.resolution_y = int(params.get("resolutionY", 240))
    scene.render.resolution_percentage = 100
    scene.render.filepath = output_path
    directory = os.path.dirname(output_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return {
        "outputPath": output_path,
        "resolutionX": scene.render.resolution_x,
        "resolutionY": scene.render.resolution_y,
    }

OPS = {
    "ping": op_ping,
    "reset_scene": op_reset_scene,
    "create_cube": op_create_cube,
    "create_sphere": op_create_sphere,
    "set_material": op_set_material,
    "set_camera": op_set_camera,
    "render_preview": op_render_preview,
    "get_scene_summary": op_get_scene_summary,
}

class McpEvalBridgeServer:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.running = False
        self.socket = None
        self.server_thread = None

    def start(self):
        if bpy.app.background:
            print("MCP Eval Bridge: background mode - bridge NOT started (GUI required, R6).")
            return
        if self.running:
            print("MCP Eval Bridge: already running on %s:%s" % (self.host, self.port))
            return
        self.running = True
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.socket.bind((self.host, self.port))
            self.socket.listen(2)
            self.server_thread = threading.Thread(target=self._server_loop)
            self.server_thread.daemon = True
            self.server_thread.start()
            print("MCP Eval Bridge: listening on %s:%s" % (self.host, self.port))
        except Exception as exc:
            print("MCP Eval Bridge: failed to start on %s:%s - %s" % (self.host, self.port, exc))
            self.stop()

    def stop(self):
        self.running = False
        if self.socket is not None:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None
        if self.server_thread is not None:
            try:
                if self.server_thread.is_alive():
                    self.server_thread.join(timeout=1.0)
            except Exception:
                pass
            self.server_thread = None
        print("MCP Eval Bridge: stopped")

    def _server_loop(self):
        self.socket.settimeout(1.0)
        while self.running:
            try:
                try:
                    client, address = self.socket.accept()
                except socket.timeout:
                    continue
                print("MCP Eval Bridge: client connected: %s" % (address,))
                client_thread = threading.Thread(target=self._handle_client, args=(client,))
                client_thread.daemon = True
                client_thread.start()
            except Exception as exc:
                if self.running:
                    print("MCP Eval Bridge: accept error - %s" % exc)

    def _handle_client(self, client):
        client.settimeout(None)
        buffer = b""
        try:
            while self.running:
                data = client.recv(8192)
                if not data:
                    break
                buffer += data
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    line = line.strip()
                    if line:
                        bpy.app.timers.register(self._make_executor(line, client), first_interval=0.0)
        except Exception as exc:
            print("MCP Eval Bridge: client error - %s" % exc)
        finally:
            try:
                client.close()
            except Exception:
                pass
            print("MCP Eval Bridge: client disconnected")

    def _make_executor(self, line, client):
        def execute():
            try:
                request = json.loads(line.decode("utf-8"))
                handler = OPS.get(request.get("op"))
                if handler is None:
                    response = {
                        "status": "error",
                        "code": "UNKNOWN_OP",
                        "message": "Unknown op %r; available: %s" % (request.get("op"), ", ".join(sorted(OPS))),
                    }
                else:
                    response = {"status": "ok", "result": handler(request.get("params") or {})}
            except BridgeOpError as exc:
                response = {"status": "error", "code": exc.code, "message": exc.message}
            except Exception as exc:
                traceback.print_exc()
                response = {"status": "error", "code": "BLENDER_SCRIPT_ERROR", "message": str(exc)}
            try:
                client.sendall((json.dumps(response) + "\n").encode("utf-8"))
            except Exception:
                print("MCP Eval Bridge: failed to send response - client gone")
            return None

        return execute

_server = None

def _deferred_start():
    global _server
    if _server is None:
        port = int(os.environ.get("MCP_EVAL_BLENDER_PORT", DEFAULT_PORT))
        _server = McpEvalBridgeServer(HOST, port)
    _server.start()
    return None

def register():
    if bpy.app.background:
        print("MCP Eval Bridge: registered in background mode (bridge starts only in GUI).")
        return
    bpy.app.timers.register(_deferred_start, first_interval=1.0)

def unregister():
    global _server
    if _server is not None:
        _server.stop()
        _server = None
