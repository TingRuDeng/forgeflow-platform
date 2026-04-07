# Rollback Template

## Trigger

- what symptom requires rollback

## Scope

- affected branch / release / worker pool

## Steps

1. stop rollout
2. restore previous release or branch
3. verify dispatcher health and mainline metrics

## Verification

- `/health`
- `/api/metrics`
- key task / review flow

