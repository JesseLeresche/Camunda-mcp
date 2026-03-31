---
name: release
description: "Version-bump, update README, build, test, commit, tag, and push. Auto-bumps minor version if no version given."
disable-model-invocation: true
argument-hint: "version (optional)"
---

# Release Camunda MCP Plugin

Create a versioned release of the Camunda Desktop Modeler MCP plugin.
Optionally provide a version (e.g. `/release 0.6.0`). If omitted, the
minor version is auto-incremented from the current version in `package.json`
(e.g. `0.5.0` becomes `0.6.0`).

## Steps

Execute these steps in order. Stop and report if any step fails.

### 1. Determine version

- If `$ARGUMENTS` is provided and matches `X.Y.Z` format, use it.
- If `$ARGUMENTS` is blank, read the current `"version"` from `package.json`
  and increment the **minor** component (e.g. `0.5.0` -> `0.6.0`,
  `1.2.3` -> `1.3.0`). Reset the patch component to `0`.
- If `$ARGUMENTS` is provided but not valid `X.Y.Z`, reject with an error.
- The tag will be `v<version>` (e.g. `v0.6.0`).

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
