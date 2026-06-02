---
name: release
description: "Semantic-version release: version-bump, update README, build, test, then open a release PR for review (tag after merge)."
disable-model-invocation: true
argument-hint: "major | minor | patch | X.Y.Z (optional, defaults to auto-detect)"
---

# Release Camunda MCP Plugin

Prepare a versioned release of the Camunda Desktop Modeler MCP plugin **as a pull
request for review**. The release artifacts are not built by this skill — they are
produced by the `release.yml` GitHub Actions workflow, which is triggered by
pushing the `v<version>` tag **after the release PR is merged**.

Provide a version bump level (`/release major`, `/release minor`, `/release patch`),
an explicit version (`/release 2.1.0`), or omit the argument to auto-detect from
the git log.

## Steps

Execute these steps in order. Stop and report if any step fails.

> **Branch policy:** `main` is protected and requires changes to land via a
> reviewed pull request. Do **not** commit, push, or tag directly on `main`.
> This skill stops once the release PR is open; tagging happens after the PR
> is reviewed and merged (Step 9).

### 1. Determine version (Semantic Versioning)

Read the current `"version"` from `package.json` as `MAJOR.MINOR.PATCH`.

**If `$ARGUMENTS` is an explicit `X.Y.Z` version:**
- Validate it is a valid semver and strictly greater than the current version.
- Use it directly.

**If `$ARGUMENTS` is a bump keyword** (`major`, `minor`, or `patch`):
- `patch` → increment PATCH (e.g. `1.2.3` → `1.2.4`)
- `minor` → increment MINOR, reset PATCH to 0 (e.g. `1.2.3` → `1.3.0`)
- `major` → increment MAJOR, reset MINOR and PATCH to 0 (e.g. `1.2.3` → `2.0.0`)

**If `$ARGUMENTS` is blank** (auto-detect from changes):
- Run `git log <last-tag>..HEAD --oneline` to review all commits since the last release.
- Apply these rules to determine the bump level:
  - **major** — if any commit message contains `BREAKING CHANGE`, `BREAKING:`, or `!:` (e.g. `feat!: remove legacy API`)
  - **minor** — if any commit adds new features or tools (look for `feat`, new tool names, new files in `src/tools/`, new functions in `client/bpmn-tools.ts`)
  - **patch** — if all commits are bug fixes, refactors, docs, or chore (look for `fix`, `refactor`, `docs`, `chore`, `style`, `test`, `ci`)
- Default to **patch** if uncertain.

**If `$ARGUMENTS` is provided but not valid** (not a semver, not a bump keyword):
- Reject with an error explaining valid options.

The tag will be `v<version>` (e.g. `v1.2.0`).

### 2. Update version number

Update the `"version"` field in `package.json` to `<version>`.

### 3. Update README version badge

In `README.md`, replace the existing `**vX.Y.Z**` version line (near the top,
line 3) with `**v<version>**`.

### 4. Update README content

Review the git log since the last release tag and update:

- The tool count in the **Overview** paragraph if new tools were added
- The **Available Tools** tables if new tools were added or tool descriptions
  changed
- The **Known Limitations** section if limitations were resolved or new ones
  added
- Do NOT rewrite sections that haven't changed

### 5. Build and test

```bash
npm run build && npm test
```

If either step fails, stop and report the error.

### 6. Create the release branch and commit

Create a dedicated release branch off an up-to-date `main` and move the changes
onto it (uncommitted edits from the steps above carry over when you switch
branches):

```bash
git fetch origin
git checkout -b release/v<version> origin/main
```

Stage **only the files changed for this release** (e.g. `package.json`,
`README.md`, and any source/docs touched as part of the release). Do **not** run
`git add -A` — leave unrelated untracked files (stray `.bpmn` exports, local
notes) out of the release commit.

```bash
git add package.json README.md <other changed files>
git commit -m "Release v<version> — <short summary of changes>"
```

Do **not** create the `v<version>` tag yet — the tag triggers the release build
and must point at the merge commit on `main`, so it is created after merge in
Step 9.

### 7. Push the branch and open a pull request

```bash
git push -u origin release/v<version>
gh pr create \
  --base main \
  --head release/v<version> \
  --title "Release v<version>" \
  --body "<summary of changes>"
```

The PR body should include:
- A short summary of what's in the release.
- A note that **merging this PR does not publish the release** — after merge,
  the `v<version>` tag must be pushed to trigger `release.yml`.
- A reviewer checklist, e.g.:
  - [ ] Version bump in `package.json` and README badge are correct
  - [ ] README content reflects the changes
  - [ ] `npm run build && npm test` pass
  - [ ] After merge: push tag `v<version>` to publish

### 8. Report (PR opened)

Print a summary and then STOP — do not tag or push to `main`:

- Version being released and the branch/PR created
- Files changed
- The PR URL (from `gh pr create`)
- The exact post-merge tag commands the user will run in Step 9

### 9. Tag after merge (post-review — only once the PR is merged)

This step runs **after** the release PR has been reviewed and merged into `main`.
Re-invoke the skill or run these commands manually:

```bash
git checkout main
git pull origin main
git tag v<version>
git push origin v<version>
```

Pushing the tag triggers the `release.yml` GitHub Actions workflow, which builds
the plugin, packages `camunda-mcp-v<version>.zip` and `.tar.gz` artifacts, and
creates the GitHub release automatically.

Report:
- Confirmation the tag was pushed
- Reminder that GitHub Actions will create the release with artifacts
- Link: `https://github.com/JesseLeresche/Camunda-mcp/actions`
