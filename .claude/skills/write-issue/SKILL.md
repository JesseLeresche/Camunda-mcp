---
name: write-issue
description: "Investigate a problem or idea and file a GitHub issue for this repo in the project's standard format — scannable, evidence-backed, correctly labeled. Use whenever asked to open/file/create a GitHub issue for Camunda-mcp, or after investigating a bug/gap that should be tracked."
argument-hint: "<short description of the problem or idea> (optional — infer from conversation if omitted)"
---

# Write a Camunda-MCP GitHub Issue

Every issue filed against this repo follows the same shape, so anyone — human or
agent — can skim the top and get the full picture without reading a wall of text.
Issue #2 (`Optimize Diagram Layout and Prevent Object Overlays`) is the reference
example of current house style — check it if unsure.

## Before writing

1. **Investigate first.** Reproduce the problem, find the actual root cause with
   `file:line` evidence (grep/read the real code, or inspect a live diagram via
   the Camunda MCP) — don't speculate or write from assumption.
2. **Check for duplicates** — run `search_issues` before creating a new one.

## Structure

1. **Title** — imperative, specific, short. No parenthetical detail dumps.
   - Good: `Close BPMN tool gaps causing Camunda validation errors`
   - Bad: `Close BPMN tool gaps (conditions, event references, blank start events)`
2. **Summary** — 2–4 sentences directly under the title, no heading needed. State
   what's wrong or proposed and why it matters. Someone should know from this
   alone whether the issue is relevant to them.
3. `## Problem` — what's actually happening today. Bulleted, bold lead-in per
   point (`**Object Overlays:** Elements frequently overlap because...`), 1–3
   lines each. Include concrete evidence (error text, file:line) but don't
   narrate the investigation here.
4. `## Proposed Solution` (or, for a bug specifically, split into
   `## Root Cause` + `## Planned Fix` if that reads clearer for the case) — the
   fix, bulleted, with `###` sub-headers only if there are genuinely distinct
   features/phases.
5. `## Considerations` — optional. Edge cases, tradeoffs, follow-on work,
   explicit out-of-scope notes.
6. **Long/deep detail goes behind a fold**, not inline. If you have extended
   evidence (multiple root causes, XML dumps, multi-diagram comparisons), keep
   the visible body scannable and collapse the rest:
   ```html
   <details>
   <summary>Full investigation detail</summary>

   ...
   </details>
   ```
   Target: the visible (non-collapsed) body should read in under ~30 lines.
7. **Cross-reference, don't restate.** Link related issues as `#<number>`
   instead of re-explaining their content.

## Labels

Confirmed current labels on this repo: `bug`, `enhancement` (there may be other
GitHub defaults present — check with `get_label` if unsure of a name).

- `bug` — something doesn't work as intended (a validation error, a tool that
  silently produces invalid output, a missing capability that should already work).
- `enhancement` — a new capability/tool being proposed that doesn't exist yet.
- **Both together is normal here** — see #2 — when the issue is "existing
  behavior is broken *and* the fix is new capability," not just one or the other.

Always pass `labels` in the same `issue_write` call that creates the issue —
don't leave it unlabeled for someone else to triage later.

## Workflow

1. Investigate (see above).
2. Draft using the structure above.
3. Pick labels per the guidance above.
4. Create via `issue_write` (`method: "create"`), passing `title`, `body`, and
   `labels` together.
5. Report back just the issue URL and a one-line summary — the user can read
   the full body on GitHub; don't paste it again into chat.
