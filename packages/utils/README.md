# @titannio/webtoolkit-utils

Typed utility toolkit for TypeScript projects, split into explicit entrypoints by environment and domain.

## Installation

```bash
npm install @titannio/webtoolkit-utils
```

Install optional peers only when you use their entrypoints:

- `react` for `@titannio/webtoolkit-utils/frameworks/react`
- `mongoose` for `@titannio/webtoolkit-utils/database/mongodb`
- `sharp` for `@titannio/webtoolkit-utils/server/media`
- `express` for richer `@titannio/webtoolkit-utils/server/http` typings

## Public Entrypoints

```ts
import { formatCurrency, resolveGeoPointCoordinates } from '@titannio/webtoolkit-utils'
import { shareContent } from '@titannio/webtoolkit-utils/browser'
import { createUploadProgressAggregator, downloadBlobFile, isImageFile, uploadFilesSequentially } from '@titannio/webtoolkit-utils/browser/files'
import { stableStringify } from '@titannio/webtoolkit-utils/data'
import { normalizeMongoose } from '@titannio/webtoolkit-utils/database/mongodb'
import { useDebounce } from '@titannio/webtoolkit-utils/frameworks/react'
import { wrapZodSchema } from '@titannio/webtoolkit-utils/frameworks/mantine'
import { buildUrl, joinUrl } from '@titannio/webtoolkit-utils/network'
import { parseFiniteNumberInput } from '@titannio/webtoolkit-utils/numbers'
import { generateRandomPassword } from '@titannio/webtoolkit-utils/server'
import { extractIpAddress } from '@titannio/webtoolkit-utils/server/http'
import { processImage } from '@titannio/webtoolkit-utils/server/media'
import { extractBearerToken, sha256Hex } from '@titannio/webtoolkit-utils/server/security'
import { escapeHtml } from '@titannio/webtoolkit-utils/text'
import { MemoryCache } from '@titannio/webtoolkit-utils/runtime/cache'
```

## Notes

- The root entrypoint only exposes environment-agnostic utilities.
- The generic date and validation helpers use ISO-style inputs by default; localized parsing belongs in explicit modules.
- Country-specific logic lives under `countries/*`.
- Database-specific logic lives under `database/*`.
- Framework-specific logic lives under `frameworks/*`.
- Some domains are intentionally exposed only through their concrete subpaths, not through aggregate umbrella entrypoints.
- Avoid deep imports from `src/*`; only the declared package exports are public.
