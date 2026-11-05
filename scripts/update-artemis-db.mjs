#!/usr/bin/env node

import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_ARRAYS = ["category", "frequency", "bandwidth", "acf", "modulation", "mode", "location"];
const DATUM_ARRAYS = ["frequency", "bandwidth", "acf", "modulation", "mode", "location"];

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (["check", "allow-removals"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
}

function validateCatalogMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Catalog metadata must be an object");
  if (!Number.isSafeInteger(value.version) || value.version <= 0) fail("Catalog version must be a positive integer");
  if (value.tag !== `v${value.version}`) fail("Catalog tag must match its numeric version");
  if (value.source !== "AresValley/Artemis-Database") fail("Catalog source must be AresValley/Artemis-Database");
  if (!/^[0-9a-f]{40}$/.test(value.sourceCommit ?? "")) fail("Catalog source commit must be a full Git commit SHA");
  if (!/^[0-9a-f]{64}$/.test(value.archiveSha256 ?? "")) fail("Catalog archive digest must be a SHA-256 hash");
  if (!Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0) fail("Catalog archive size must be a positive integer");
  requireString(value.releasedAt, "Catalog release date");
  if (Number.isNaN(Date.parse(value.releasedAt))) fail("Catalog release date must be an ISO date");
  for (const field of ["releaseUrl", "archiveUrl"]) {
    requireString(value[field], `Catalog ${field}`);
    const url = new URL(value[field]);
    if (url.protocol !== "https:" || url.hostname !== "github.com") fail(`Catalog ${field} must be an HTTPS github.com URL`);
  }
}

function validateMedia(value, label) {
  if (value == null) return;
  if (typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object or null`);
  for (const field of ["filename", "url"]) {
    if (value[field] != null && typeof value[field] !== "string") fail(`${label}.${field} must be a string`);
  }
}

function validateSignal(signal, directoryName, releaseVersion) {
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) fail(`${directoryName}/signal.json must contain an object`);
  if (String(signal.pageid) !== directoryName) fail(`${directoryName}/signal.json has a mismatched pageid`);
  requireString(signal.title, `${directoryName}.title`);
  if (!Number.isSafeInteger(signal.added_since) || signal.added_since <= 0 || signal.added_since > releaseVersion) {
    fail(`${directoryName}.added_since must be a positive version no newer than v${releaseVersion}`);
  }
  for (const field of REQUIRED_ARRAYS) {
    if (!Array.isArray(signal[field])) fail(`${directoryName}.${field} must be an array`);
  }
  if (!signal.category.every((item) => typeof item === "string" && item.trim())) fail(`${directoryName}.category contains an invalid value`);
  for (const field of DATUM_ARRAYS) {
    for (const [index, datum] of signal[field].entries()) {
      if (!datum || typeof datum !== "object" || Array.isArray(datum)) fail(`${directoryName}.${field}[${index}] must be an object`);
      if (!(["string", "number"].includes(typeof datum.value)) || (typeof datum.value === "number" && !Number.isFinite(datum.value))) {
        fail(`${directoryName}.${field}[${index}].value is invalid`);
      }
      if (datum.description != null && typeof datum.description !== "string") fail(`${directoryName}.${field}[${index}].description must be a string`);
    }
  }
  for (const field of ["short description", "description"]) {
    if (typeof signal[field] !== "string") fail(`${directoryName}.${field} must be a string`);
  }
  validateMedia(signal.spectrum, `${directoryName}.spectrum`);
  validateMedia(signal.audio, `${directoryName}.audio`);
}

function compareSignals(left, right) {
  const leftTitle = left.title.toLocaleLowerCase();
  const rightTitle = right.title.toLocaleLowerCase();
  if (leftTitle < rightTitle) return -1;
  if (leftTitle > rightTitle) return 1;
  return Number(left.pageid) - Number(right.pageid);
}

async function readExistingCount(outputPath) {
  try {
    const current = JSON.parse(await readFile(outputPath, "utf8"));
    return Array.isArray(current) ? current.length : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function readExistingVersion(outputPath) {
  try {
    const current = JSON.parse(await readFile(outputPath, "utf8"));
    return Number.isSafeInteger(current?.version) ? current.version : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

export async function updateCatalog({ upstreamDir, metadataPath, signalsOut, metadataOut, check = false, allowRemovals = false }) {
  for (const [value, label] of [[upstreamDir, "upstream directory"], [metadataPath, "metadata path"], [signalsOut, "signals output"], [metadataOut, "metadata output"]]) {
    requireString(value, label);
  }
  await access(upstreamDir, constants.R_OK);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  validateCatalogMetadata(metadata);

  const entries = await readdir(upstreamDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
  if (!directories.length) fail("No numeric signal directories were found");

  const signals = [];
  const seenPageIds = new Set();
  for (const directory of directories) {
    const signalPath = path.join(upstreamDir, directory.name, "signal.json");
    let signal;
    try {
      signal = JSON.parse(await readFile(signalPath, "utf8"));
    } catch (error) {
      fail(`Unable to read ${signalPath}: ${error.message}`);
    }
    validateSignal(signal, directory.name, metadata.version);
    if (seenPageIds.has(signal.pageid)) fail(`Duplicate pageid ${signal.pageid}`);
    seenPageIds.add(signal.pageid);
    signals.push(signal);
  }

  signals.sort(compareSignals);
  const previousCount = await readExistingCount(signalsOut);
  if (!allowRemovals && previousCount && signals.length < Math.ceil(previousCount * 0.9)) {
    fail(`Catalog shrank from ${previousCount} to ${signals.length}; pass --allow-removals only after manual review`);
  }

  const nextMetadata = { ...metadata, signalCount: signals.length };
  const signalsJson = `${JSON.stringify(signals, null, 2)}\n`;
  const metadataJson = `${JSON.stringify(nextMetadata, null, 2)}\n`;

  const existingVersion = await readExistingVersion(metadataOut);
  if (!check && existingVersion === metadata.version) {
    try {
      const currentSignals = await readFile(signalsOut, "utf8");
      if (currentSignals !== signalsJson) fail(`Catalog records changed without a version increment from v${metadata.version}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  if (check) {
    const [currentSignals, currentMetadata] = await Promise.all([
      readFile(signalsOut, "utf8"),
      readFile(metadataOut, "utf8"),
    ]);
    if (currentSignals !== signalsJson || currentMetadata !== metadataJson) fail("Generated catalog files are not current");
  } else {
    await Promise.all([
      atomicWrite(signalsOut, signalsJson),
      atomicWrite(metadataOut, metadataJson),
    ]);
  }

  return { signalCount: signals.length, version: metadata.version, tag: metadata.tag };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  const result = await updateCatalog({
    upstreamDir: options["upstream-dir"],
    metadataPath: options.metadata,
    signalsOut: options["signals-out"] ?? "app/data/signals.json",
    metadataOut: options["metadata-out"] ?? "app/data/catalog.json",
    check: Boolean(options.check),
    allowRemovals: Boolean(options["allow-removals"]),
  });
  process.stdout.write(`Validated Artemis DB ${result.tag}: ${result.signalCount} signals\n`);
}
