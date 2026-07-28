---
name: write-fix-comment
description: "Post a GitHub issue comment documenting a bug found and fixed while working that issue — how it was found, the bug, the fix, and the test that proved it. Use whenever a bug fix (found mid-work, not the issue's original scope) needs to be recorded on a Camunda-mcp issue. Do not use for the issue's own initial write-up — that's write-issue."
argument-hint: "<issue number> (optional — infer from conversation if omitted)"
---

# Write a Camunda-MCP Issue Fix Comment

Issues in this repo accumulate comments as bugs are found and fixed mid-work
(see issue #5's thread). Each comment is a complete, closed loop — never a
progress note or a promise to verify later. A reader should be able to trust
that anything posted here already happened exactly as described.

## The four required parts, in order

1. **How Found** — what you were doing when this surfaced. One or two
   sentences of real context (e.g. "found while stress-testing build_process
   with a 60-element diagram"), not "found a bug."
2. **Bug** — the observable wrong behavior, with concrete evidence (an actual
   error string, a diff between expected/actual output, a reproduction). Not
   a guess, not "might be an issue with X."
3. **Fix** — what changed, `file:line` or function names, and **the actual
   commit SHA** once it exists. Reference it as a short SHA with a one-line
   description, e.g. `a1b2c3d — replace shell.openPath with tab-manager
   openDiagram`.
4. **Test** — the specific check you ran against the *fixed* code that proves
   it now works, and its actual result. Not "should work now," not "will
   verify next" — the real output of the real test.

## Hard rule: don't post until all four are real

If you don't yet have a passing test result, **you don't have a comment
yet** — you have a TODO. Do not post something with a placeholder like
"live-verification next" or "needs a restart to confirm." Finish the work
first:

1. Investigate and find the root cause (grep/read the real code — see
   write-issue's investigation guidance, it applies here too).
2. Implement the fix.
3. Commit it (per this repo's normal commit rules — only when the user asks,
   new commit not amend, following CLAUDE.md/repo conventions). Note the SHA.
4. Actually run the fixed code and observe the result — live against the
   running Modeler where applicable, not just a clean build/typecheck. A
   build passing is not a test; it just means the code compiles.
5. Only once you have a real commit SHA and a real test result, write and
   post the comment.

If something blocks step 4 (e.g. a change needs a Modeler restart you can't
trigger), that means the comment isn't ready — say so to the user and wait,
don't post a partial comment as a placeholder.

## Format

Plain prose under each of the four labels (bold lead-in, not `##` headers —
these are comments, not sub-issues). Keep it tight: this is an addendum to
the issue, not a new write-up. Example shape:

```
Found while <doing X> — <one more sentence of context if useful>.

**Bug:** <observable wrong behavior + evidence>

**Fix:** <what changed, file:line/function> (`<sha>` — <one-line summary>)

**Test:** <what you ran against the fixed code> — <actual result>
```

If this bug is itself a duplicate of / supersedes another open issue, fold
it in explicitly (state the other issue number, close it as duplicate) —
same pattern as issue #7 being folded into #5.

## Workflow

1. Confirm the bug isn't already documented on the issue (read existing
   comments first — don't duplicate).
2. Investigate, fix, commit — gather all four parts for real (see above).
3. Draft the comment in the format above.
4. Post via `add_issue_comment`.
5. Report back just the comment URL and a one-line summary — don't paste the
   full body again into chat.

## If a previous comment was posted incomplete

If an earlier comment on the issue was posted without a real commit SHA
and/or a real test result (e.g. it said "verification next"), delete it
once you have the complete picture, and post a fresh comment that has all
four parts filled in for real. Don't leave the incomplete version up
alongside the complete one.
