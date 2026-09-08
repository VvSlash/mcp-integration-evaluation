import type { McpServer } from "@modelcontextprotocol/server";
import { getSharedBridge, type OwnBlenderBridge } from "./bridge.js";

type SceneSummaryPayload = {
  count?: number;
  activeCamera?: string | null;
  objects?: Array<{
    name?: string;
    type?: string;
    location?: number[];
    dimensions?: number[];
    material?: { name?: string; baseColorHex?: string | null } | null;
  }>;
};

export function formatSceneSummary(summary: SceneSummaryPayload): string {
  const lines: string[] = [];
  const objects = summary.objects ?? [];
  lines.push(`Scene objects: ${summary.count ?? objects.length}`);
  lines.push(`Active camera: ${summary.activeCamera ?? "(none)"}`);
  for (const object of objects) {
    const location = (object.location ?? []).map((value) => value.toFixed(2)).join(", ");
    const material = object.material
      ? ` material=${object.material.name ?? "?"} baseColor=${object.material.baseColorHex ?? "?"}`
      : "";
    lines.push(`- ${object.name ?? "?"} [${object.type ?? "?"}] location=(${location})${material}`);
  }
  return lines.join("\n");
}

export function registerBlenderResources(
  server: McpServer,
  bridge: OwnBlenderBridge = getSharedBridge()
): void {
  server.registerResource(
    "blender-scene",
    "blender://scene",
    {
      description:
        "Text summary of the current Blender scene: objects with types, locations and materials, plus the active camera.",
      mimeType: "text/plain"
    },
    async (uri) => {
      const summary = (await bridge.command("get_scene_summary")) as SceneSummaryPayload;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: formatSceneSummary(summary)
          }
        ]
      };
    }
  );
}
