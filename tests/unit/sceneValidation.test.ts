import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  colorWithinTolerance,
  findReferenceScene,
  loadReferenceScenes,
  validateSceneAgainstReference,
  type SceneSummary
} from "../../src/servers/blender/sceneValidation.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const referencesFile = path.join(repoRoot, "datasets", "blender", "reference_scenes.yaml");

const blend001Scene: SceneSummary = {
  count: 4,
  activeCamera: "Camera",
  objects: [
    { name: "Cube", type: "MESH", location: [0, 0, 0], dimensions: [2, 2, 2] },
    { name: "Light", type: "LIGHT", location: [4.08, 1.01, 5.9] },
    { name: "Camera", type: "CAMERA", location: [6, -6, 4], viewDirection: [-0.64, 0.64, -0.42] },
    { name: "MyCube", type: "MESH", location: [1, 1, 0], dimensions: [1, 1, 1] }
  ]
};

describe("reference_scenes.yaml (repo)", () => {
  it("ładuje wszystkie referencje z kompletem identyfikatorów BLEND + XSRV-002", async () => {
    const scenes = await loadReferenceScenes(referencesFile);
    const ids = scenes.map((scene) => scene.id);
    expect(ids).toEqual([
      "BLEND-001-reference",
      "BLEND-002-reference",
      "BLEND-003-reference",
      "XSRV-002-reference"
    ]);
  });
});

describe("validateSceneAgainstReference", () => {
  it("BLEND-001: kostka + kamera patrząca na kostkę przechodzi (obiekty nadmiarowe tolerowane)", async () => {
    const scenes = await loadReferenceScenes(referencesFile);
    const reference = findReferenceScene(scenes, "BLEND-001-reference");
    expect(reference).not.toBeNull();
    const result = validateSceneAgainstReference(blend001Scene, reference!);
    expect(result.checks.map((check) => check.passed)).toEqual([true, true, true]);
    expect(result.passed).toBe(true);
  });

  it("BLEND-001: kamera odwrócona od kostki oblewa kontrolę kątową", async () => {
    const scenes = await loadReferenceScenes(referencesFile);
    const reference = findReferenceScene(scenes, "BLEND-001-reference");
    const scene: SceneSummary = {
      objects: blend001Scene.objects.map((object) =>
        object.type === "CAMERA" ? { ...object, viewDirection: [0.64, -0.64, 0.42] } : object
      )
    };
    const result = validateSceneAgainstReference(scene, reference!);
    expect(result.passed).toBe(false);
    const cameraCheck = result.checks.find((check) => check.label.startsWith("kamera"));
    expect(cameraCheck?.passed).toBe(false);
  });

  it("BLEND-002: '~czerwony' akceptuje #EE1100 (tolerancja 0.2), odrzuca niebieski i brak światła", async () => {
    const scenes = await loadReferenceScenes(referencesFile);
    const reference = findReferenceScene(scenes, "BLEND-002-reference");
    const redSphereScene: SceneSummary = {
      objects: [
        {
          name: "Sphere",
          type: "MESH",
          location: [0, 0, 0],
          material: { name: "SphereMaterial", baseColorHex: "#EE1100" }
        },
        { name: "Light", type: "LIGHT", location: [4, 1, 6] }
      ]
    };
    expect(validateSceneAgainstReference(redSphereScene, reference!).passed).toBe(true);

    const blueSphereScene: SceneSummary = {
      objects: [
        { name: "Sphere", type: "MESH", material: { name: "M", baseColorHex: "#0000FF" } },
        { name: "Light", type: "LIGHT" }
      ]
    };
    expect(validateSceneAgainstReference(blueSphereScene, reference!).passed).toBe(false);

    const noLightScene: SceneSummary = { objects: [redSphereScene.objects[0]!] };
    expect(validateSceneAgainstReference(noLightScene, reference!).passed).toBe(false);
  });

  it("XSRV-002: trzy meshe o dowolnych nazwach — każde oczekiwanie konsumuje INNY obiekt", async () => {
    const scenes = await loadReferenceScenes(referencesFile);
    const reference = findReferenceScene(scenes, "XSRV-002-reference");
    const threeCubes: SceneSummary = {
      objects: [
        { name: "Order5012", type: "MESH", dimensions: [9.5, 9.5, 9.5] },
        { name: "Order4801", type: "MESH", dimensions: [8.1, 8.1, 8.1] },
        { name: "Order4633", type: "MESH", dimensions: [7.2, 7.2, 7.2] }
      ]
    };
    expect(validateSceneAgainstReference(threeCubes, reference!).passed).toBe(true);

    const twoCubes: SceneSummary = { objects: threeCubes.objects.slice(0, 2) };
    expect(validateSceneAgainstReference(twoCubes, reference!).passed).toBe(false);
  });
});

describe("colorWithinTolerance", () => {
  it("porównuje kanały RGB w skali 0..1", () => {
    expect(colorWithinTolerance("#FF3333", "#FF0000", 0.2)).toBe(true);
    expect(colorWithinTolerance("#FF6666", "#FF0000", 0.2)).toBe(false);
    expect(colorWithinTolerance("zielony", "#FF0000", 0.2)).toBe(false);
  });
});
