# webtoolkit-utils

Typed utility toolkit for TypeScript projects, split into explicit entrypoints by environment and domain.

## Installation

```bash
npm install webtoolkit-utils
```

Install optional peers only when you use their entrypoints:

- `react` for `webtoolkit-utils/frameworks/react`
- `mongoose` for `webtoolkit-utils/database/mongodb`
- `sharp` for `webtoolkit-utils/server/media`
- `express` for richer `webtoolkit-utils/server/http` typings

## Public Entrypoints

```ts
import { formatCurrency, resolveGeoPointCoordinates } from 'webtoolkit-utils'
import { shareContent } from 'webtoolkit-utils/browser'
import { isImageFile } from 'webtoolkit-utils/browser/files'
import { normalizeMongoose } from 'webtoolkit-utils/database/mongodb'
import { useDebounce } from 'webtoolkit-utils/frameworks/react'
import { wrapZodSchema } from 'webtoolkit-utils/frameworks/mantine'
import { generateRandomPassword } from 'webtoolkit-utils/server'
import { extractIpAddress } from 'webtoolkit-utils/server/http'
import { processImage } from 'webtoolkit-utils/server/media'
```

## Notes

- The root entrypoint only exposes environment-agnostic utilities.
- The generic date and validation helpers use ISO-style inputs by default; localized parsing belongs in explicit modules.
- Country-specific logic lives under `countries/*`.
- Database-specific logic lives under `database/*`.
- Framework-specific logic lives under `frameworks/*`.
- Some domains are intentionally exposed only through their concrete subpaths, not through aggregate umbrella entrypoints.
- Avoid deep imports from `src/*`; only the declared package exports are public.
