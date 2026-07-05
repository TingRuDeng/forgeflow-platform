import type { ArtifactBundle } from './TaskTimeline';

interface ArtifactRefEntry {
  key: string;
  ref: string;
}

export function flattenArtifactRefs(bundle: ArtifactBundle): ArtifactRefEntry[] {
  return Object.entries(bundle.refs ?? {}).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return value.map((ref, index) => ({ key: `${key}.${index + 1}`, ref }));
    }
    return value ? [{ key, ref: value }] : [];
  });
}
