# Release-Please + Docker Publish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable `docker pull ghcr.io/ivannovazzi/moveet-*` for end users via automated releases triggered by conventional commits.

**Architecture:** Two GitHub Actions workflows with strict permission separation. release-please maintains a Release PR on every push to main; merging it creates a GitHub Release. A second workflow triggers on `release: published` to build and push three Docker images to ghcr.io. Single version across the monorepo (apps are tightly coupled). A root-level `docker-compose.ghcr.yml` lets users run the full stack from published images without cloning.

**Tech Stack:** GitHub Actions, release-please, Docker buildx, ghcr.io (GitHub Container Registry)

---

### Task 1: release-please configuration

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.release-please-manifest.json`
- Create: `release-please-config.json`

**Step 1: Create release-please manifest**

This tracks the current version. Single `.` entry = whole monorepo versioned together.

`.release-please-manifest.json`:
```json
{
  ".": "2.0.0"
}
```

**Step 2: Create release-please config**

`release-please-config.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "component": "moveet",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "extra-files": [
        "apps/simulator/package.json",
        "apps/adapter/package.json",
        "apps/ui/package.json"
      ]
    }
  }
}
```

Note: `extra-files` ensures all three app package.json versions stay in sync with the root.

**Step 3: Create release workflow**

`.github/workflows/release.yml`:
```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

**Step 4: Commit**

```bash
git add .release-please-manifest.json release-please-config.json .github/workflows/release.yml
git commit -m "ci: add release-please workflow and config"
```

---

### Task 2: Docker publish workflow

**Files:**
- Create: `.github/workflows/docker-publish.yml`

**Step 1: Create docker publish workflow**

`.github/workflows/docker-publish.yml`:
```yaml
name: Docker Publish

on:
  release:
    types: [published]

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - image: moveet-simulator
            context: apps/simulator
          - image: moveet-adapter
            context: apps/adapter
          - image: moveet-ui
            context: apps/ui

    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ github.repository_owner }}/${{ matrix.image }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Key design notes:
- **Immutable tags**: `v2.0.0` is never overwritten. Semver pattern tags (`2.0`, `2`) update to point at latest patch/minor.
- **No `latest` tag**: forces users to pin versions. Add `type=raw,value=latest` to the tags block if you want it later.
- **GHA cache**: speeds up rebuilds by caching Docker layers in GitHub Actions cache.
- **Matrix build**: all three images build in parallel.
- **`GITHUB_TOKEN`**: no PAT needed. `packages:write` permission is sufficient for ghcr.io within the same repo owner.

**Step 2: Commit**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add Docker publish workflow on release"
```

---

### Task 3: Docker Compose for published images

**Files:**
- Create: `docker-compose.ghcr.yml`
- Modify: `README.md`

**Step 1: Create compose file for published images**

`docker-compose.ghcr.yml`:
```yaml
# Run the full Moveet stack from published images (no build required).
# Usage: docker compose -f docker-compose.ghcr.yml up
services:
  simulator:
    image: ghcr.io/ivannovazzi/moveet-simulator:latest
    ports:
      - "5010:3000"
    environment:
      - PORT=3000
      - UPDATE_INTERVAL=300
      - USE_ADAPTER=true
      - ADAPTER_URL=http://adapter:5011

  adapter:
    image: ghcr.io/ivannovazzi/moveet-adapter:latest
    ports:
      - "5011:5011"
    environment:
      - PORT=5011
      - SOURCE_TYPE=static
      - SINK_TYPES=console

  ui:
    image: ghcr.io/ivannovazzi/moveet-ui:latest
    ports:
      - "5012:8080"
    environment:
      - API_URL=http://simulator:3000
      - WS_URL=ws://simulator:3000
```

**Step 2: Add usage section to README.md**

Add a "Run with Docker" section near the top (after the features list, before Architecture), with:

```markdown
## Run with Docker

Pull and run the full stack — no clone or build needed:

\```bash
curl -O https://raw.githubusercontent.com/ivannovazzi/moveet/main/docker-compose.ghcr.yml
docker compose -f docker-compose.ghcr.yml up
\```

Open [http://localhost:5012](http://localhost:5012) to view the dashboard.

Images are published to GitHub Container Registry on every release:
- `ghcr.io/ivannovazzi/moveet-simulator`
- `ghcr.io/ivannovazzi/moveet-adapter`
- `ghcr.io/ivannovazzi/moveet-ui`
```

**Step 3: Commit**

```bash
git add docker-compose.ghcr.yml README.md
git commit -m "docs: add Docker Compose for published images and update README"
```

---

### Task 4: Lock down existing CI permissions

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Add explicit permissions to ci.yml**

Add at the top level of the workflow (after `on:`):

```yaml
permissions:
  contents: read
```

This follows least-privilege: CI only needs to read the repo, not write anything. Without explicit permissions, the default `GITHUB_TOKEN` gets broad read/write access.

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: restrict CI workflow to read-only permissions"
```

---

### Task 5: Add contributing guidance for conventional commits

**Files:**
- Modify: `CONTRIBUTING.md`

**Step 1: Read current CONTRIBUTING.md and add a section on commit conventions**

Add a section explaining the conventional commit format that release-please expects:

```markdown
## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and changelogs. Format your commit messages as:

- `feat: add postgres source plugin` — new feature (bumps minor version)
- `fix: correct route calculation near intersections` — bug fix (bumps patch version)
- `feat!: redesign plugin configuration API` — breaking change (bumps major version)
- `chore: update dependencies` — maintenance (no release)
- `docs: improve adapter setup guide` — documentation (no release)

The first line should be lowercase, imperative, and under 72 characters.
```

**Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add conventional commits guidance to CONTRIBUTING.md"
```

---

## Summary

| Workflow | Trigger | Permissions | What it does |
|---|---|---|---|
| `ci.yml` | push + PR | `contents: read` | lint, test, build |
| `release.yml` | push to main | `contents: write`, `pull-requests: write` | Maintains Release PR, creates GitHub Release on merge |
| `docker-publish.yml` | release published | `contents: read`, `packages: write` | Builds + pushes 3 Docker images to ghcr.io |

**Contributor flow:**
1. Fork → branch → conventional commits → PR
2. CI runs lint/test/build (read-only, safe for forks)
3. Maintainer merges PR to main
4. release-please auto-updates its Release PR
5. Maintainer merges Release PR when ready to ship
6. GitHub Release created → Docker images built and pushed

**Immutability guarantees:**
- Git tags created by release-please are immutable
- Docker tags like `2.0.0` are pushed once and never overwritten
- Semver convenience tags (`2.0`, `2`) update to track latest within their range
