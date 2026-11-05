import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRelease } from "../scripts/discover-artemis-release.mjs";

const repository = "AresValley/Artemis-Database";
const tag = "v74";
const archiveSha256 = "4ef66d5e0eddbc5430cc102f84de0489efd40b979bc6b78abdf259999d09d052";
const archiveBytes = 302172160;
const sourceCommit = "31ef32cade8b6e8c643f2bc08c01cc86ce293d04";
const archiveUrl = `https://github.com/${repository}/releases/download/${tag}/${tag}.tar`;
const releasedAt = "2026-11-03T18:52:07Z";

const legacyMetadata = {
  version: 74,
  tag,
  releasedAt: "2026-07-18T14:13:32Z",
  source: "AresValley/Artemis-DB",
  sourceCommit: "e54d5c32de6b5386d6f9db677c9cd3520a06f737",
  releaseUrl: "https://github.com/AresValley/Artemis-DB/releases/tag/v74",
  archiveUrl: "https://github.com/AresValley/Artemis-DB/releases/download/v74/v74.tar",
  archiveSha256,
  archiveBytes,
  signalCount: 583,
};

const currentMetadata = {
  ...legacyMetadata,
  releasedAt,
  source: repository,
  sourceCommit,
  releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`,
  archiveUrl,
};

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function upstreamFetch({ commit = sourceCommit } = {}) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.endsWith("/AresValley/Artemis/master/config/release-info.json")) {
      return jsonResponse({ sigID_DB: { version: 74, url: archiveUrl, sha256_hash: archiveSha256, total_bytes: archiveBytes } });
    }
    if (url === `https://api.github.com/repos/${repository}/releases/latest`) {
      return jsonResponse({
        tag_name: tag,
        draft: false,
        prerelease: false,
        published_at: releasedAt,
        html_url: `https://github.com/${repository}/releases/tag/${tag}`,
        assets: [{ name: `${tag}.tar`, browser_download_url: archiveUrl, size: archiveBytes, digest: `sha256:${archiveSha256}` }],
      });
    }
    if (url === `https://api.github.com/repos/${repository}/git/ref/tags/${tag}`) {
      return jsonResponse({ object: { type: "commit", sha: commit } });
    }
    return jsonResponse({ message: "Not Found" }, 404);
  };
  return { fetchImpl, requests };
}

async function fixture(metadata) {
  const root = await mkdtemp(path.join(os.tmpdir(), "artemis-release-test-"));
  const currentMetadataPath = path.join(root, "catalog.json");
  const manifestPath = path.join(root, "release.json");
  await writeFile(currentMetadataPath, `${JSON.stringify(metadata)}\n`);
  return { root, currentMetadataPath, manifestPath };
}

test("release discovery migrates verified same-version provenance to Artemis-Database", async () => {
  const files = await fixture(legacyMetadata);
  const upstream = upstreamFetch();
  try {
    const result = await discoverRelease({ ...files, fetchImpl: upstream.fetchImpl });
    assert.equal(result.update, true);
    assert.deepEqual(result.manifest, await readFile(files.manifestPath, "utf8").then(JSON.parse));
    assert.equal(result.manifest.source, repository);
    assert.equal(result.manifest.sourceCommit, sourceCommit);
    assert.equal(result.manifest.archiveSha256, legacyMetadata.archiveSha256);
    assert.ok(upstream.requests.every((url) => !url.includes("/AresValley/Artemis-DB/")));
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("release discovery is stable after the provenance migration", async () => {
  const files = await fixture(currentMetadata);
  try {
    const result = await discoverRelease({ ...files, fetchImpl: upstreamFetch().fetchImpl });
    assert.equal(result.update, false);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("release discovery rejects same-version archive or tag replacement", async (context) => {
  await context.test("archive replacement", async () => {
    const files = await fixture({ ...currentMetadata, archiveSha256: "a".repeat(64) });
    try {
      await assert.rejects(
        discoverRelease({ ...files, fetchImpl: upstreamFetch().fetchImpl }),
        /archive changed without a version increment/,
      );
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });

  await context.test("tag replacement", async () => {
    const files = await fixture(currentMetadata);
    try {
      await assert.rejects(
        discoverRelease({ ...files, fetchImpl: upstreamFetch({ commit: "a".repeat(40) }).fetchImpl }),
        /tag changed without a version increment/,
      );
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });
});
