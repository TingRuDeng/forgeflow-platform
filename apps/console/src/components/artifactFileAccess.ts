export interface ParsedArtifactRef {
  bundleId: string;
  fileName: string;
}

export function parseArtifactRef(ref: string): ParsedArtifactRef | null {
  const prefix = 'artifact://';
  if (!ref.startsWith(prefix)) return null;
  const refPath = ref.slice(prefix.length);
  const separatorIndex = refPath.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === refPath.length - 1) return null;
  return {
    bundleId: refPath.slice(0, separatorIndex),
    fileName: refPath.slice(separatorIndex + 1),
  };
}

export async function readArtifactRefFile(ref: string): Promise<{ content: string; fileName: string }> {
  const parsed = parseArtifactRef(ref);
  if (!parsed) return { content: '', fileName: 'artifact.txt' };
  const url = `/api/artifacts/${encodeURIComponent(parsed.bundleId)}/files/${encodeURIComponent(parsed.fileName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  try {
    const parsedBody = JSON.parse(text) as { content?: unknown; fileName?: unknown };
    return {
      content: typeof parsedBody.content === 'string' ? parsedBody.content : text,
      fileName: typeof parsedBody.fileName === 'string' ? parsedBody.fileName : parsed.fileName,
    };
  } catch {
    return { content: text, fileName: parsed.fileName };
  }
}

export function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
