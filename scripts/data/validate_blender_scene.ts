import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeSharedBridge, getSharedBridge } from "../../src/servers/blender/bridge.js";
import {
  findReferenceScene,
  loadReferenceScenes,
  validateSceneAgainstReference,
  type SceneSummary
} from "../../src/servers/blender/sceneValidation.js";

const REFERENCES_FILE = path.join("datasets", "blender", "reference_scenes.yaml");

function parseArgs(argv: string[]): { reference: string; summaryFile: string | null } {
  let reference: string | null = null;
  let summaryFile: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--reference" && argv[index + 1]) {
      reference = argv[++index] as string;
    } else if (argv[index] === "--summary" && argv[index + 1]) {
      summaryFile = argv[++index] as string;
    }
  }
  if (!reference) {
    throw new Error(
      "Użycie: npm run validate:blender-scene -- --reference <id z reference_scenes.yaml> [--summary <plik.json>]"
    );
  }
  return { reference, summaryFile };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenes = await loadReferenceScenes(REFERENCES_FILE);
  const reference = findReferenceScene(scenes, options.reference);
  if (!reference) {
    throw new Error(
      `Brak referencji "${options.reference}" w ${REFERENCES_FILE} (dostępne: ${scenes.map((scene) => scene.id).join(", ")}).`
    );
  }

  let summary: SceneSummary;
  if (options.summaryFile) {
    summary = JSON.parse(await readFile(options.summaryFile, "utf8")) as SceneSummary;
    console.log(`Podsumowanie sceny: ${options.summaryFile}`);
  } else {
    const bridge = getSharedBridge();
    summary = (await bridge.command("get_scene_summary")) as SceneSummary;
    console.log(`Podsumowanie sceny: na żywo przez most ${bridge.address} (${summary.objects.length} obiektów).`);
  }

  const result = validateSceneAgainstReference(summary, reference);
  console.log(`\nReferencja: ${result.referenceId}${reference.description ? ` — ${reference.description}` : ""}`);
  for (const check of result.checks) {
    console.log(`  [${check.passed ? "OK " : "FAIL"}] ${check.label} — ${check.details}`);
  }
  console.log(result.passed ? "\nWYNIK: scena ZGODNA z referencją." : "\nWYNIK: scena NIEZGODNA z referencją.");
  await closeSharedBridge();
  process.exit(result.passed ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeSharedBridge().catch(() => undefined);
  process.exit(1);
});
