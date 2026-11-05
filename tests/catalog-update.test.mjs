import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateCatalog } from "../scripts/update-artemis-db.mjs";

const metadata = {
  version: 75,
  tag: "v75",
  releasedAt: "2026-08-01T12:00:00Z",
  source: "AresValley/Artemis-Database",
  sourceCommit: "a".repeat(40),
  releaseUrl: "https://github.com/AresValley/Artemis-Database/releases/tag/v75",
  archiveUrl: "https://github.com/AresValley/Artemis-Database/releases/download/v75/v75.tar",
  archiveSha256: "b".repeat(64),
  archiveBytes: 12345,
};

function signal(pageid, title) {
  return {
    pageid,
    title,
    added_since: 75,
    spectrum: null,
    audio: null,
    category: ["Digital"],
    frequency: [{ value: 1000, description: "" }],
    bandwidth: [],
    acf: [],
    modulation: [{ value: "FSK", description: "" }],
    mode: [],
    location: [],
    "short description": "Fixture signal",
    description: "Fixture signal used to verify deterministic catalog generation.",
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "artemis-catalog-test-"));
  const upstreamDir = path.join(root, "static");
  const metadataPath = path.join(root, "release.json");
  const signalsOut = path.join(root, "signals.json");
  const metadataOut = path.join(root, "catalog.json");
  await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`);
  for (const item of [signal("20", "Zulu"), signal("10", "alpha")]) {
    const directory = path.join(upstreamDir, item.pageid);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "signal.json"), `${JSON.stringify(item)}\n`);
  }
  return { root, upstreamDir, metadataPath, signalsOut, metadataOut };
}

test("catalog updater validates, sorts, records provenance, and supports reproducibility checks", async () => {
  const files = await fixture();
  try {
    const result = await updateCatalog(files);
    assert.deepEqual(result, { signalCount: 2, version: 75, tag: "v75" });
    const generatedSignals = JSON.parse(await readFile(files.signalsOut, "utf8"));
    const generatedMetadata = JSON.parse(await readFile(files.metadataOut, "utf8"));
    assert.deepEqual(generatedSignals.map((item) => item.pageid), ["10", "20"]);
    assert.equal(generatedMetadata.signalCount, 2);
    assert.equal(generatedMetadata.sourceCommit, metadata.sourceCommit);
    await updateCatalog({ ...files, check: true });
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("catalog updater rejects a suspiciously large removal", async () => {
  const files = await fixture();
  try {
    await writeFile(files.signalsOut, `${JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ pageid: String(index) })), null, 2)}\n`);
    await assert.rejects(updateCatalog(files), /Catalog shrank from 30 to 2/);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("catalog updater rejects record changes without a version increment", async () => {
  const files = await fixture();
  try {
    await updateCatalog(files);
    const changed = signal("10", "changed title");
    await writeFile(path.join(files.upstreamDir, "10", "signal.json"), `${JSON.stringify(changed)}\n`);
    await assert.rejects(updateCatalog(files), /Catalog records changed without a version increment from v75/);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});
