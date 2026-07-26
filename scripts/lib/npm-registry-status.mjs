import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const MAX_REGISTRY_RESPONSE_BYTES = 10 * 1024 * 1024;

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
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const request = client.get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      let responseBytes = 0;
      response.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > MAX_REGISTRY_RESPONSE_BYTES) {
          const error = new Error(`${packageName} registry 响应超过 10 MiB`);
          response.destroy(error);
          request.destroy(error);
          finish({ status: "unknown", version: "", versions: {}, distTags: {}, error: error.message });
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", (error) => {
        finish({ status: "unknown", version: "", versions: {}, distTags: {}, error: error.message });
      });
      response.on("end", () => {
        if (settled) {
          return;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        finish(parseRegistryResponse(packageName, response.statusCode, body));
      });
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`${packageName} registry 查询超时`));
    });
    request.on("error", (error) => {
      finish({ status: "unknown", version: "", versions: {}, distTags: {}, error: error.message });
    });
  });
}

function parseRegistryResponse(packageName, statusCode, body) {
  if (statusCode === 404) {
    return { status: "missing", version: "", versions: {}, distTags: {} };
  }
  if (!statusCode || statusCode < 200 || statusCode >= 300) {
    return {
      status: "unknown",
      version: "",
      versions: {},
      distTags: {},
      error: `${packageName} registry HTTP ${statusCode}`,
    };
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("registry response must be an object");
    }
    if (parsed.name !== packageName) {
      throw new Error(
        `registry package name mismatch: expected ${packageName}, got ${parsed.name ?? "<missing>"}`,
      );
    }
    if (!parsed.versions || typeof parsed.versions !== "object" || Array.isArray(parsed.versions)) {
      throw new Error("registry response is missing versions metadata");
    }
    const distTags = mapDistTags(parsed["dist-tags"]);
    return {
      status: "published",
      version: distTags.latest ?? "",
      versions: mapVersionMetadata(parsed.versions),
      distTags,
    };
  } catch (error) {
    return {
      status: "unknown",
      version: "",
      versions: {},
      distTags: {},
      error: `registry JSON 解析失败：${error.message}`,
    };
  }
}

function readFixturePackage(fixturePackage) {
  if (fixturePackage.status === "missing") {
    return { status: "missing", version: "", versions: {}, distTags: {} };
  }
  if (fixturePackage.status === "unknown") {
    return {
      status: "unknown",
      version: "",
      versions: {},
      distTags: {},
      error: fixturePackage.error || "fixture unknown",
    };
  }
  const versionNames = Array.isArray(fixturePackage.versions)
    ? fixturePackage.versions
    : Object.keys(fixturePackage.versions || {});
  const versions = Object.fromEntries(versionNames.map((version) => [
    version,
    fixturePackage.metadata?.[version]
      ?? (typeof fixturePackage.versions?.[version] === "object" ? fixturePackage.versions[version] : true),
  ]));
  const distTags = mapDistTags(fixturePackage.distTags);
  if (!distTags.latest && fixturePackage.latest) {
    distTags.latest = fixturePackage.latest;
  }
  return {
    status: "published",
    version: distTags.latest || versionNames[0] || "",
    versions,
    distTags,
  };
}

function mapDistTags(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, version]) => typeof version === "string" && version !== ""),
  );
}

function mapVersionMetadata(versions) {
  return Object.fromEntries(Object.entries(versions).map(([version, metadata]) => [
    version,
    {
      dist: metadata?.dist && typeof metadata.dist === "object"
        ? {
            integrity: typeof metadata.dist.integrity === "string" ? metadata.dist.integrity : "",
            shasum: typeof metadata.dist.shasum === "string" ? metadata.dist.shasum : "",
            tarball: typeof metadata.dist.tarball === "string" ? metadata.dist.tarball : "",
          }
        : null,
    },
  ]));
}

function decideVersionStatus(packageStatus, wantedVersion) {
  if (packageStatus.status !== "published") {
    return { status: "not_checked", version: "" };
  }
  const metadata = packageStatus.versions?.[wantedVersion];
  if (metadata) {
    return {
      status: "published",
      version: wantedVersion,
      dist: metadata === true ? null : metadata.dist ?? null,
    };
  }
  return { status: "missing", version: "" };
}
