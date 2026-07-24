import type { ZodIssue, ZodSchema } from 'zod'

/**
 * Successful parse result shape expected by Mantine resolver integration.
 *
 * @typedef {{ success: true }} MantineZodParseSuccess
 */
type MantineZodParseSuccess = {
  success: true
}

type MantineZodResolverIssue = {
  path: Array<string | number>
  message: string
}

type MantineZodParseError = {
  success: false
  error: {
    errors: MantineZodResolverIssue[]
  }
}

type WrappedZodSchema<T extends Record<string, unknown>> = {
  safeParse: (values: T) => MantineZodParseSuccess | MantineZodParseError
}

/**
 * Wraps a Zod schema with Mantine-compatible error output shape.
 *
 * @param {ZodSchema<T>} schema - Zod schema.
 * @returns {WrappedZodSchema<T>} Wrapped schema adapter.
 */
export function wrapZodSchema<T extends Record<string, unknown>>(schema: ZodSchema<T>): WrappedZodSchema<T> {
  return {
    safeParse: (values: T) => {
      const result = schema.safeParse(values)
      if (!result.success) {
        const resolverErrors: MantineZodResolverIssue[] = result.error.issues.map((issue: ZodIssue) => ({
          path: issue.path.filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number'),
          message: issue.message,
        }))

        return {
          success: false,
          error: {
            errors: resolverErrors,
          },
        }
      }

      return result
    },
  }
}
