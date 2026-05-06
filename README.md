# WebToolkit

Repository for the **`webtoolkit-utils`** package.

`webtoolkit-utils` is a TypeScript utility library focused on:

- Real reuse between frontend and backend.
- Explicit entrypoints by environment and domain.
- Typed and predictable APIs.
- Isolation of country-specific rules.

## Package Purpose

This package centralizes shared utilities in one place, avoiding duplication and tight coupling between applications.

The organization follows two principles:

1. What is **agnostic** (does not depend on a specific country/business) stays in generic modules.
2. What is **specific** stays in dedicated folders (e.g., `countries/BR`, `database/mongodb`, `frameworks/react`).

This lets each consumer import only what it needs from the correct subpath, without relying on internals.

## Structure (High-Level)

- `packages/utils/src/core` -> errors and basic contracts
- `packages/utils/src/data` -> object/JSON manipulation
- `packages/utils/src/dates` -> generic date utilities
- `packages/utils/src/network` -> HTTP/fetch helpers
- `packages/utils/src/server` -> server-side utilities
- `packages/utils/src/browser` -> browser-side utilities
- `packages/utils/src/frameworks/*` -> framework integrations
- `packages/utils/src/database/*` -> database integrations
- `packages/utils/src/countries/*` -> country-specific local rules

## Contribution Rule

Suggestions are very welcome.

To keep the package coherent, new proposals should follow one of these directions:

- **Agnostic**: reusable utilities with no country/local-rule dependency.
- **Country-specific**: implemented **inside the corresponding country folder** in `packages/utils/src/countries/<COUNTRY>`.

In other words:

- Do not mix local rules into generic modules.
- Do not spread country rules outside `countries/*`.

## How To Use The Published Package

```bash
npm install webtoolkit-utils
```

Import examples:

```ts
import { formatCurrency } from 'webtoolkit-utils'
import { shareContent } from 'webtoolkit-utils/browser'
import { wrapZodSchema } from 'webtoolkit-utils/frameworks/mantine'
import { extractIpAddress } from 'webtoolkit-utils/server/http'
```

## Local Development

```bash
cd packages/utils
npm install
npm run test
npm run test:coverage
```

## Notes

- The root entrypoint exposes only agnostic utilities.
- Local rules must stay in `countries/*`.
- Avoid deep imports from `src/*`; use only public package exports.
