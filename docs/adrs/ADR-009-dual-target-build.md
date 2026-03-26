# ADR-009: Dual-target build for Bun development and Node.js distribution

**Status:** Accepted
**Date:** 2026-03-26

---

## Context

bract is Bun-first (ADR philosophy). Development uses Bun's zero-config TypeScript support for fast feedback loops. But packages also need to work for Node.js users who install via npm.

The Bun bundler's `--target bun` bundles all dependencies inline, including `node:fs`. This produces output that breaks in Node.js (imports resolve to empty objects `{}`). Simply publishing bundled Bun output to npm creates broken packages for Node.js consumers.

## Decision

### Two build targets per package

Each package outputs to both targets from separate `bun build` invocations:

1. **Bun target** (`dist/bun/`)
   - `bun build ./src/index.ts --outdir ./dist/bun --target bun`
   - Bundled, optimized for Bun runtime
   - For npm distribution to Bun users

2. **Node.js target** (`dist/node/`)
   - `bun build ./src/index.ts --outdir ./dist/node --target node --packages external`
   - Keeps all external imports as-is (not bundled)
   - Node.js resolves them at runtime
   - Works for both Node.js and Bun at runtime

3. **Declarations** (`dist/`)
   - `tsc --emitDeclarationOnly --outDir dist`
   - Shared `.d.ts` and `.d.ts.map` files (target-agnostic)

### Why `--packages external` for Node target

When `--packages external` is set, the Bun bundler does not inline package imports. Instead, it outputs ESM import statements. Node.js resolves these at runtime using the package's export conditions.

Example:
```javascript
// With --packages external:
import { ProcessTable } from '@losoft/bract-runtime';

// Without --packages external (default --target bun):
var {ProcessTable} = (() => ({}));  // ← broken
```

### Export conditions strategy

In `package.json` exports:

```json
{
  "bun": "./src/index.ts",           // workspace development (source TypeScript)
  "node": "./dist/node/index.js",    // Node.js consumers (packages external)
  "import": "./dist/node/index.js",  // fallback (most compatible)
  "types": "./dist/index.d.ts"       // all targets (shared)
}
```

- `"bun"` → source TypeScript: Bun resolves directly in workspace; no compilation overhead
- `"node"` → Node.js build: Bun uses this when installed via npm (no `"bun"` condition in that context)
- `"import"` → Node.js build: Fallback for environments that don't recognize `"node"` condition

### Build scripts organization

Per-package npm scripts for clarity:

```bash
npm run build:bun    # Single --target bun pass
npm run build:node   # Single --target node --packages external pass
npm run build:types  # Single tsc --emitDeclarationOnly pass
npm run build        # All three (default; each independent)
```

This makes the build purpose explicit and allows selective rebuilds during development.

### CLI special case: compiled standalone binary

The CLI package adds a fourth build:

```bash
npm run build:cli    # bun build --compile → dist/bract (Linux ELF executable)
```

The `bin` field points to this executable. Benefits:
- Zero runtime dependencies (Bun and Node.js bundled into the binary)
- Users can `npm install -g bract` and run `bract` directly
- Faster startup than `bun bract` or `node bract.js`

### Why not use `--compile` for all packages?

`--compile` requires an entrypoint and produces a single executable. Suitable for CLI, not for libraries. Libraries need to export classes/functions at the module level, which `--compile` doesn't support.

## Consequences

### Good

**Dual compatibility.** Bun users get the bundled output (smaller, optimized). Node.js users get packages-external output (more portable).

**Development speed.** Workspace consumers import source TypeScript directly; no rebuild needed after editing. Bun transpiles and runs TypeScript directly.

**No duplication.** Same source code compiles to both targets. No separate copies or conditional compilation.

**Clear separation.** Build scripts separate `bun`, `node`, and `types` concerns. Each can be understood and tested independently.

**CLI is standalone.** The `bract` binary needs no runtime. Can be packaged in Docker, or used in minimal environments.

### Tricky

**Build time.** Three passes per package. For the supervisor package (1MB bundled output), this adds ~100ms per build. Acceptable for a monorepo of 4 packages.

**`--target bun` output not Node.js-compatible.** The bundled Bun output cannot be used as npm's default export. Only the `--packages external` build works for Node.js. This is why the fallback `"import"` condition points to the Node.js build, not the Bun build.

**Runtime import of packages external.** When `--packages external` is used, the bundler depends on correct export conditions in dependencies. If `@losoft/bract-runtime` ever has a broken `"node"` export, the dependent packages' Node.js builds will fail at runtime. Mitigated by testing both builds (`npm run build` runs both targets).

## Alternatives Considered

### Single bundled output for all targets

Bundle everything with `--target bun` and publish that. Rejected: doesn't work in Node.js. Users would see broken imports.

### ESM + CommonJS dual output

Emit `.js` (ESM) and `.cjs` (CommonJS) files. Rejected: adds complexity (separate transpilation, dual test suites), and bract focuses on modern ESM only.

### Use `tsc` for compilation instead of `bun build`

TypeScript produces node-friendly code without bundling issues. Rejected: loses Bun's bundling optimization for production; slower builds; doesn't use Bun's native speed advantage.

### Keep only Node.js build, drop Bun optimization

One build per package with `--target node --packages external`. Rejected: Bun npm consumers lose bundling optimization (larger, slower downloads). Contradicts "Bun-first" philosophy.

## References

- Bun bundler docs: https://bun.com/docs/bundler
- Bun's `--target` and `--packages` options
- Node.js export conditions: https://nodejs.org/api/packages.html#packages_exports
- ADR-001: Bun-first philosophy
