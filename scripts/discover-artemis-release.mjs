#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const RELEASE_INFO_URL = "https://raw.githubusercontent.com/AresValley/Artemis/master/config/release-info.json";
const DATABASE_REPOSITORY = "AresValley/Artemis-Database";
const LEGACY_DATABASE_REPOSITORY = "AresValley/Artemis-DB";
const RELEASE_API_URL = `https://api.github.com/repos/${DATABASE_REPOSITORY}/releases/latest`;
const TAG_API_BASE = `https://api.github.com/repos/${DATABASE_REPOSITORY}/git`;
const PROVENANCE_FIELDS = [
  "version",
  "tag",
  "releasedAt",
  "source",
  "sourceCommit",
  "releaseUrl",
  "archiveUrl",
  "archiveSha256",
  "archiveBytes",
];

function fail(message) {
  throw new Error(message);
}

async function getJson(url, githubToken, fetchImpl) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "AndrewMohawk/artemis-webapp" };
  if (githubToken && url.startsWith("https://api.github.com/")) headers.Authorization = `Bearer ${githubToken}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok) fail(`Request failed (${response.status}) for ${url}`);
  return response.json();
}

async function resolveTagCommit(tag, githubToken, fetchImpl) {
  let object = (await getJson(`${TAG_API_BASE}/ref/tags/${encodeURIComponent(tag)}`, githubToken, fetchImpl)).object;
  for (let depth = 0; object?.type === "tag" && depth < 5; depth += 1) {
    object = (await getJson(`${TAG_API_BASE}/tags/${object.sha}`, githubToken, fetchImpl)).object;
  }
  if (object?.type !== "commit" || !/^[0-9a-f]{40}$/.test(object.sha ?? "")) fail("Release tag does not resolve to a Git commit");
  return object.sha;
}

function normalizeDigest(value) {
  return String(value ?? "").replace(/^sha256:/, "").toLocaleLowerCase();
}

export async function discoverRelease({ currentMetadataPath, manifestPath, githubToken, outputPath, fetchImpl = fetch }) {
  const current = JSON.parse(await readFile(currentMetadataPath, "utf8"));
  const currentVersion = Number(current.version);
  if (!Number.isSafeInteger(currentVersion) || currentVersion <= 0) fail("Bundled catalog has an invalid database version");
  if (![DATABASE_REPOSITORY, LEGACY_DATABASE_REPOSITORY].includes(current.source)) {
    fail(`Bundled catalog has an unexpected source: ${current.source}`);
  }
  const [releaseInfo, release] = await Promise.all([
    getJson(RELEASE_INFO_URL, undefined, fetchImpl),
    getJson(RELEASE_API_URL, githubToken, fetchImpl),
  ]);

  const database = releaseInfo?.sigID_DB;
  const version = Number(database?.version);
  const tag = release?.tag_name;
  if (!Number.isSafeInteger(version) || version <= 0) fail("Official release metadata has an invalid database version");
  if (tag !== `v${version}`) fail("Latest GitHub release and official Artemis release metadata do not agree");
  if (release.draft || release.prerelease) fail("Latest Artemis-Database release is not a final release");
  if (!/^[0-9a-f]{64}$/.test(database.sha256_hash ?? "")) fail("Official release metadata has an invalid archive digest");
  if (!Number.isSafeInteger(database.total_bytes) || database.total_bytes <= 0) fail("Official release metadata has an invalid archive size");

  const asset = release.assets?.find((candidate) => candidate.name === `${tag}.tar`);
  if (!asset) fail(`Release ${tag} has no ${tag}.tar asset`);
  if (asset.browser_download_url !== database.url) fail("GitHub release asset URL does not match official release metadata");
  if (asset.size !== database.total_bytes) fail("GitHub release asset size does not match official release metadata");
  if (asset.digest && normalizeDigest(asset.digest) !== normalizeDigest(database.sha256_hash)) {
    fail("GitHub release asset digest does not match official release metadata");
  }

  if (version < currentVersion) fail(`Upstream version v${version} is older than bundled version v${current.version}`);
  const sourceCommit = await resolveTagCommit(tag, githubToken, fetchImpl);
  const manifest = {
    version,
    tag,
    releasedAt: release.published_at,
    source: DATABASE_REPOSITORY,
    sourceCommit,
    releaseUrl: release.html_url,
    archiveUrl: database.url,
    archiveSha256: normalizeDigest(database.sha256_hash),
    archiveBytes: database.total_bytes,
  };
  if (!manifest.releasedAt || Number.isNaN(Date.parse(manifest.releasedAt))) fail("Release publication date is invalid");
  if (!manifest.releaseUrl) fail("Release page URL is missing");

  if (version === currentVersion) {
    if (normalizeDigest(current.archiveSha256) !== manifest.archiveSha256 || current.archiveBytes !== manifest.archiveBytes) {
      fail(`Artemis-Database v${version} archive changed without a version increment`);
    }
    if (current.source === DATABASE_REPOSITORY && current.sourceCommit !== manifest.sourceCommit) {
      fail(`Artemis-Database v${version} tag changed without a version increment`);
    }
  }

  const update = PROVENANCE_FIELDS.some((field) => current[field] !== manifest[field]);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (outputPath) {
    await appendFile(outputPath, `update=${update}\nversion=${version}\ntag=${tag}\nsource_commit=${sourceCommit}\n`, "utf8");
  }
  return { update, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await discoverRelease({
    currentMetadataPath: process.argv[2] ?? "app/data/catalog.json",
    manifestPath: process.argv[3] ?? ".artemis-release.json",
    githubToken: process.env.GITHUB_TOKEN,
    outputPath: process.env.GITHUB_OUTPUT,
  });
  process.stdout.write(result.update
    ? `Verified new Artemis DB release ${result.manifest.tag}\n`
    : `Artemis DB ${result.manifest.tag} is already bundled\n`);
}
