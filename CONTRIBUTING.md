# Contributing to Moveet

Thank you for your interest in contributing to Moveet! This guide will help you get started.

## Prerequisites

- **Node.js** >= 18
- **npm** (ships with Node.js)
- **yarn** (required for the UI project)

## Development Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/moveet.git
   cd moveet
   ```

2. Install dependencies from the root:

   ```bash
   npm install
   ```

3. Copy environment files for each project that needs one:

   ```bash
   cp apps/simulator/.env.example apps/simulator/.env
   cp apps/adapter/.env.example apps/adapter/.env
   cp apps/ui/.env.example apps/ui/.env
   ```

   Review each `.env` file and adjust values if needed.

## Running Locally

You can start the full stack from the root using Turborepo:

```bash
npm run dev      # starts all projects
npm run build    # builds all projects
npm run test     # runs tests across all projects
```

Or run each project individually:

| Project | Directory | Commands |
|---|---|---|
| **simulator** (simulation engine) | `apps/simulator/` | `npm run dev` (port 5010) |
| **adapter** (bridge service) | `apps/adapter/` | `npm run dev` (port 5011) |
| **ui** (dashboard) | `apps/ui/` | `yarn dev` (port 5012) |

The simulator works standalone with synthetic vehicles. The adapter is only needed when connecting to an external fleet management system.

## Project Structure

- **apps/simulator/** -- Core simulation engine. Loads a GeoJSON road network, builds a graph, runs A* pathfinding, and simulates vehicle movement. Exposes a REST API and WebSocket server.
- **apps/adapter/** -- Optional bridge that translates between the simulator's HTTP API and external systems (GraphQL, Kafka/Redpanda).
- **apps/ui/** -- React dashboard with a custom D3.js SVG map renderer showing vehicles, routes, heat zones, and points of interest.

## Code Style

- **TypeScript** is used throughout all three projects.
- **ESLint** enforces code quality. Run the linter before submitting changes:
  - `npm run lint` in `apps/simulator/` and `apps/adapter/`
  - `yarn lint` in `apps/ui/`
- **Prettier** handles formatting in the UI project.
- Follow existing conventions in the codebase. When in doubt, match the style of surrounding code.

## Testing

All projects use **Vitest** as the test framework. Please run the relevant tests before opening a pull request:

```bash
# From the root (runs all tests via Turborepo)
npm run test

# Or per-project
cd apps/simulator && npm test
cd apps/adapter && npm test
cd apps/ui && yarn test
```

If you are adding a new feature or fixing a bug, include tests that cover the change.

## Pull Request Process

1. **Fork** the repository and create a new branch from `main`:

   ```bash
   git checkout -b my-feature
   ```

2. Make your changes, keeping commits focused and well-described.

3. Run linting and tests to make sure everything passes.

4. Push your branch and open a pull request against `main`.

5. In the PR description, explain what the change does and why. Link any related issues.

6. A maintainer will review your PR. Address any feedback, and the PR will be merged once approved.

## Reporting Bugs

Please use **GitHub Issues** to report bugs. A good bug report includes:

- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected behavior vs. actual behavior.
- Your environment (OS, Node.js version, browser if relevant).
- Any relevant logs or screenshots.

## Questions?

If something is unclear or you need help getting started, feel free to open an issue with your question. We appreciate all contributions, large and small.
