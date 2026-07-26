const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".git",
  ".gnupg",
  ".kube",
  ".ssh",
]);

const SENSITIVE_FILES = new Set([
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

const SENSITIVE_EXTENSIONS = [
  ".jks",
  ".key",
  ".kdbx",
  ".keystore",
  ".p12",
  ".p8",
  ".pem",
  ".pfx",
];

export function assertSafeReleaseFilePath(filePath, label = "release tarball") {
  const normalized = filePath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || segments.some((segment) => segment === "." || segment === ".." || segment === "")
    || /[\0\r\n]/.test(normalized)
  ) {
    throw new Error(`unsafe ${label} path: ${filePath}`);
  }

  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const basename = lowerSegments.at(-1) ?? "";
  if (
    lowerSegments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))
    || SENSITIVE_FILES.has(basename)
    || basename === ".env"
    || basename.startsWith(".env.")
    || SENSITIVE_EXTENSIONS.some((extension) => basename.endsWith(extension))
  ) {
    throw new Error(`${label} contains sensitive file: ${normalized}`);
  }

  return normalized;
}
