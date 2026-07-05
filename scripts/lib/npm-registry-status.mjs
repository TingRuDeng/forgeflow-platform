import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

export function parsePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readRegistryFixture(filePath) {
  if (!filePath) {
    return null;
  }
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

export async function queryPackageRegistry(spec, options) {
  const fixturePackage = options.fixture?.packages?.[spec.name];
  const packageStatus = fixturePackage
    ? readFixturePackage(fixturePackage)
    : await requestRegistryDocument(spec.name, options);
  const versionStatus = decideVersionStatus(packageStatus, spec.version);
  return { packageStatus, versionStatus };
}

export function decideRegistryAction(packageStatus, versionStatus) {
  if (packageStatus.status === "missing") {
    return "setup_required";
  }
  if (packageStatus.status === "unknown" || versionStatus.status === "unknown") {
    return "registry_unknown";
  }
  if (versionStatus.status === "missing") {
    return "publish_version";
  }
  if (versionStatus.status === "published") {
    return "up_to_date";
  }
  return "not_checked";
}

function requestRegistryDocument(packageName, options) {
  const url = new URL(encodeURIComponent(packageName), options.registryUrl);
  const client = url.protocol === "http:" ? http : https;
  return new Promise((resolve) => {
    const request = client.get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(parseRegistryResponse(packageName, response.statusCode, body));
      });
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`${packageName} registry 查询超时`));
    });
    request.on("error", (error) => {
      resolve({ status: "unknown", version: "", versions: {}, error: error.message });
    });
  });
}

function parseRegistryResponse(packageName, statusCode, body) {
  if (statusCode === 404) {
    return { status: "missing", version: "", versions: {} };
  }
  if (!statusCode || statusCode < 200 || statusCode >= 300) {
    return { status: "unknown", version: "", versions: {}, error: `${packageName} registry HTTP ${statusCode}` };
  }
  try {
    const parsed = JSON.parse(body);
    return {
      status: "published",
      version: parsed["dist-tags"]?.latest ?? "",
      versions: mapVersionKeys(parsed.versions ?? {}),
    };
  } catch (error) {
    return { status: "unknown", version: "", versions: {}, error: `registry JSON 解析失败：${error.message}` };
  }
}

function readFixturePackage(fixturePackage) {
  if (fixturePackage.status === "missing") {
    return { status: "missing", version: "", versions: {} };
  }
  if (fixturePackage.status === "unknown") {
    return { status: "unknown", version: "", versions: {}, error: fixturePackage.error || "fixture unknown" };
  }
  const versions = Object.fromEntries((fixturePackage.versions || []).map((version) => [version, true]));
  return { status: "published", version: fixturePackage.latest || fixturePackage.versions?.[0] || "", versions };
}

function mapVersionKeys(versions) {
  return Object.fromEntries(Object.keys(versions).map((version) => [version, true]));
}

function decideVersionStatus(packageStatus, wantedVersion) {
  if (packageStatus.status !== "published") {
    return { status: "not_checked", version: "" };
  }
  if (packageStatus.versions?.[wantedVersion]) {
    return { status: "published", version: wantedVersion };
  }
  return { status: "missing", version: "" };
}
