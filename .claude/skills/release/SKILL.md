---
name: release
description: "Semantic-version release: version-bump, update README, build, test, commit, tag, and push."
disable-model-invocation: true
argument-hint: "major | minor | patch | X.Y.Z (optional, defaults to auto-detect)"
---

# Release Camunda MCP Plugin

Create a versioned release of the Camunda Desktop Modeler MCP plugin.

Provide a version bump level (`/release major`, `/release minor`, `/release patch`),
an explicit version (`/release 2.1.0`), or omit the argument to auto-detect from
the git log.

## Steps

Execute these steps in order. Stop and report if any step fails.

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

### 6. Commit and tag

Stage all changed files and commit:

```
Release v<version> — <short summary of changes>
```

Then tag the commit as `v<version>`.

### 7. Push

```bash
git push origin main
git push origin v<version>
```

This triggers the `release.yml` GitHub Actions workflow, which builds the
plugin, packages `camunda-mcp-v<version>.zip` and `.tar.gz` artifacts, and
creates the GitHub release automatically.

### 8. Report

Print a summary:

- Version released
- Files changed
- Reminder that GitHub Actions will create the release with artifacts
- Link: `https://github.com/JesseLeresche/Camunda-mcp/actions`
