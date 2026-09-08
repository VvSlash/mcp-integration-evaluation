import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { env } from "../../config/env.js";
import { BlenderBridgeError, getSharedBridge, type OwnBlenderBridge } from "./bridge.js";

const locationSchema = z.array(z.number()).length(3);

const colorHexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use #RRGGBB, e.g. #FF0000");

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

function okResult(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(error: unknown): ToolResult {
  const code = error instanceof BlenderBridgeError ? error.code : "BLENDER_TOOL_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] };
}

function definedParams(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

export function registerBlenderTools(server: McpServer, bridge: OwnBlenderBridge = getSharedBridge()): void {
  server.registerTool(
    "blender_create_cube",
    {
      description:
        "Create a cube mesh in the current Blender scene. Optional: name, size (edge length, default 2) and location [x, y, z] (default origin). Returns the created object's name.",
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        size: z.number().positive().optional(),
        location: locationSchema.optional()
      })
    },
    async (args) => {
      try {
        return okResult(
          await bridge.command(
            "create_cube",
            definedParams({ name: args.name, size: args.size, location: args.location })
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "blender_create_sphere",
    {
      description:
        "Create a UV sphere mesh in the current Blender scene. Optional: name, radius (default 1) and location [x, y, z] (default origin). Returns the created object's name.",
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        radius: z.number().positive().optional(),
        location: locationSchema.optional()
      })
    },
    async (args) => {
      try {
        return okResult(
          await bridge.command(
            "create_sphere",
            definedParams({ name: args.name, radius: args.radius, location: args.location })
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "blender_set_material",
    {
      description:
        "Assign a new material with the given base color to an existing object (by exact object name). colorHex is #RRGGBB, e.g. #FF0000 for red. Optional metallic and roughness in [0, 1].",
      inputSchema: z.object({
        object: z.string().min(1),
        colorHex: colorHexSchema,
        metallic: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional()
      })
    },
    async (args) => {
      try {
        return okResult(
          await bridge.command(
            "set_material",
            definedParams({
              object: args.object,
              colorHex: args.colorHex,
              metallic: args.metallic,
              roughness: args.roughness
            })
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "blender_set_camera",
    {
      description:
        "Place the scene camera at location [x, y, z] and aim it at the lookAt point [x, y, z]. Creates a camera if the scene has none and makes it the active camera.",
      inputSchema: z.object({
        location: locationSchema,
        lookAt: locationSchema
      })
    },
    async (args) => {
      try {
        return okResult(await bridge.command("set_camera", { location: args.location, lookAt: args.lookAt }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "blender_render_preview",
    {
      description:
        "Render a low-resolution preview of the current scene through the active camera and save it to outputPath (PNG). Default resolution 320x240 (renders can be slow).",
      inputSchema: z.object({
        outputPath: z.string().min(1),
        resolutionX: z.number().int().positive().optional(),
        resolutionY: z.number().int().positive().optional()
      })
    },
    async (args) => {
      try {
        return okResult(
          await bridge.command(
            "render_preview",
            definedParams({
              outputPath: args.outputPath,
              resolutionX: args.resolutionX,
              resolutionY: args.resolutionY
            }),
            env.blender.renderTimeoutMs
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "blender_get_scene_summary",
    {
      description:
        "List all objects in the current Blender scene: name, type (MESH/CAMERA/LIGHT/...), location, dimensions, first material with its base color, and the camera view direction. Use it to verify scene state.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        return okResult(await bridge.command("get_scene_summary"));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
