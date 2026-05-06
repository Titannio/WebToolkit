import { describe, expect, it } from 'vitest'

import * as browser from '@src/browser/index.js'
import * as browserFiles from '@src/browser/files/index.js'
import * as root from '@src/public/index.js'
import * as countries from '@src/countries/index.js'
import * as countryBR from '@src/countries/BR/index.js'
import * as core from '@src/core/index.js'
import * as data from '@src/data/index.js'
import * as dates from '@src/dates/index.js'
import * as files from '@src/files/index.js'
import * as finance from '@src/finance/index.js'
import * as geo from '@src/geo/index.js'
import * as network from '@src/network/index.js'
import * as mongodb from '@src/database/mongodb/index.js'
import * as numbers from '@src/numbers/index.js'
import * as pagination from '@src/pagination/index.js'
import * as privacy from '@src/privacy/index.js'
import * as random from '@src/random/index.js'
import * as react from '@src/frameworks/react/index.js'
import * as mantine from '@src/frameworks/mantine/index.js'
import * as runtime from '@src/runtime/index.js'
import * as search from '@src/search/index.js'
import * as security from '@src/security/index.js'
import * as server from '@src/server/index.js'
import * as serverHttp from '@src/server/http/index.js'
import * as text from '@src/text/index.js'
import * as types from '@src/types/index.js'
import * as ui from '@src/ui/index.js'
import * as validation from '@src/validation/index.js'

describe('public entrypoints', () => {
  it('exposes the expected representative exports', () => {
    expect(root.formatCurrency).toBeTypeOf('function')
    expect(browser.processImage).toBeTypeOf('function')
    expect(browserFiles.isImageFile).toBeTypeOf('function')
    expect(countries.getCountryConfig).toBeTypeOf('function')
    expect(countryBR.formatCPF).toBeTypeOf('function')
    expect(mongodb.normalizeMongoose).toBeTypeOf('function')
    expect(react.useDebounce).toBeTypeOf('function')
    expect(mantine.wrapZodSchema).toBeTypeOf('function')
    expect(server.generateRandomPassword).toBeTypeOf('function')
    expect(core.extractErrorMessage).toBeTypeOf('function')
    expect(data.parseJSONDates).toBeTypeOf('function')
    expect(dates.toDate).toBeTypeOf('function')
    expect(files.isValidImageSignature).toBeTypeOf('function')
    expect(finance.parseCurrency).toBeTypeOf('function')
    expect(geo.resolveGeoPointCoordinates).toBeTypeOf('function')
    expect(network.ensureUrlProtocol).toBeTypeOf('function')
    expect(serverHttp.extractIpAddress).toBeTypeOf('function')
    expect(numbers.formatPercentRatio).toBeTypeOf('function')
    expect(pagination.createPaginationQuerySchema).toBeTypeOf('function')
    expect(privacy.maskSensitiveData).toBeTypeOf('function')
    expect(random.generateRandomString).toBeTypeOf('function')
    expect(runtime.MemoryCache).toBeTypeOf('function')
    expect(search.normalizeSearchText).toBeTypeOf('function')
    expect(security.parseJwt).toBeTypeOf('function')
    expect(text.toKebabCase).toBeTypeOf('function')
    expect(types.PHONE_TYPE).toBeDefined()
    expect(ui.getContrastColor).toBeTypeOf('function')
    expect(validation.validateEmail).toBeTypeOf('function')
    expect((countryBR as Record<string, unknown>).getBrazilianCities).toBeUndefined()
    expect(root.normalizeBsonDocument).toBeUndefined()
    expect((network as Record<string, unknown>).extractIpAddress).toBeUndefined()
    expect((files as Record<string, unknown>).validateImageMagicBytes).toBeUndefined()
  })
})
