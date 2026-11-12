# Overtable JavaScript packages

Sources of the Overtable npm packages, published from this repository with provenance.

| npm name | Folder | What it is |
| --- | --- | --- |
| `@overtable/schemas` | `packages/schemas` | The shapes of Overtable's typed exchanges and requests, as Zod schemas, TypeScript types and JSON Schema |
| `@overtable/verify` | `packages/verify` | Offline verification of Overtable's signed receipts |
| `@overtable/sdk` | `packages/sdk` | TypeScript SDK for Overtable's partner API |
| `@overtable/mcp` | `packages/mcp` | A local MCP server that gives an assistant its Overtable bot's tools |
| `overtable` | `packages/cli` | The command line: `npx overtable connect` |

`packages/shared` holds the parts of Overtable's shared code that these packages bundle. It is not published on its own.

## Where the code comes from

Overtable develops these packages next to its relay, in a private repository. Each release copies them here through a pull request: the copy leaves out the tests that need the relay (they run before the copy). The pull request merges on its own once the checks of this repository pass. Pull requests opened by hand are welcome too; a change that lands here is carried back by hand.

## Checks

Every pull request runs `.github/workflows/check.yml`:

- **scan**: gitleaks over the tree, and `scripts/publish/check-public.mjs` (no import of a workspace that is not here, no personal names, no plans and no dates in the docs);
- **build, test, pack**: `npm ci`, the TypeScript build, the tests, then each package staged, packed with `npm pack`, installed outside the checkout and type-checked.

```sh
npm ci
npm run build
npm test
npm run stage      # .publish/<package>/, the package.json written from scripts/publish/packages.json
npm run dry-run    # npm pack, install outside the checkout, strict type-check
```

## Releases

`.github/workflows/release-packages.yml` runs by hand only (Actions > release-packages > Run workflow), with a `dry-run` input that is on by default. With `dry-run` off, it publishes on npm with trusted publishing (OIDC) and `npm publish --provenance --access public`, in this order: `@overtable/schemas`, `@overtable/verify`, `@overtable/sdk`, `@overtable/mcp`, `overtable`. The publish job runs in the environment `npm`, which waits for a maintainer's approval.

## Licence

Apache 2.0, see `LICENSE` and the `LICENSE` of each package. Security reports: see `SECURITY.md`.
