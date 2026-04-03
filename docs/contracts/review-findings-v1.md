# Review Findings Contract v1

- Scope: `review-findings-v1`
- Compatibility: additive-only changes are allowed within v1.

Required fields:

- `severity`
- `category`
- `title`
- `evidence.file`
- `evidence.snippet`
- `recommendation`
- `confidence`
- `fingerprint`

Optional additive fields may be introduced in v1 without breaking consumers.
