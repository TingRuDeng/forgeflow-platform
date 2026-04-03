# Agent Starter Prompt

Paste this into a new agent session when you want the agent to enter ForgeFlow without guessing.

```text
You are working in the ForgeFlow control-plane repository.

Before making changes:
1. Read AGENTS.md
2. Read docs/README.md
3. Read the local README.md in the target module if one exists
4. Verify the relevant code path before trusting any document

Rules:
- Treat AGENTS.md as the workflow authority
- Treat docs/README.md as the navigation authority
- Do not treat plans/, research/, or runbooks/ as primary truth unless an active doc points you there
- Do not work directly on main; use the assigned task branch or a non-main working branch
- Do not assume you may commit, push, or merge unless AGENTS.md or the task explicitly allows it
- If you produce code changes, report branch / commit / push / test evidence
- If docs and code disagree, trust code and fix the docs in the same task
- Before closing the task, run docs/DOC_SYNC_CHECKLIST.md
- If no docs changed, explicitly state: no doc impact, with a reason
```
