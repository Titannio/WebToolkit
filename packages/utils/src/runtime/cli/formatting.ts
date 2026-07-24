/**
 * @module cli.utils
 * @description Small formatting helpers for command-line output.
 */

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_REGEX = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g')

/**
 * Removes ANSI escape sequences from a string.
 *
 * @param {string} value - Input text.
 * @returns {string} Text without ANSI escape sequences.
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, '')
}

/**
 * Pads text based on visible length, ignoring ANSI escape sequences.
 *
 * @param {string} value - Input text.
 * @param {number} width - Target visible width.
 * @returns {string} Padded text.
 */
export function padAnsi(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - stripAnsi(value).length))
}

/**
 * Column descriptor for ASCII table rendering.
 */
export interface AsciiTableColumn<T> {
  header: string
  getValue: (row: T) => string | number
}

/**
 * Builds a simple ASCII table from rows and column definitions.
 *
 * @param {readonly T[]} rows - Table rows.
 * @param {readonly AsciiTableColumn<T>[]} columns - Column definitions.
 * @returns {string} Formatted ASCII table.
 */
export function buildAsciiTable<T>(
  rows: readonly T[],
  columns: readonly AsciiTableColumn<T>[]
): string {
  const values = rows.map((row) => columns.map((column) => String(column.getValue(row))))
  const widths = columns.map((column, index) =>
    Math.max(stripAnsi(column.header).length, ...values.map((row) => stripAnsi(row[index]).length))
  )

  const horizontal = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`
  const headerLine = `| ${columns
    .map((column, index) => padAnsi(column.header, widths[index]))
    .join(' | ')} |`
  const rowLines = values.map((row) =>
    `| ${row.map((value, index) => padAnsi(value, widths[index])).join(' | ')} |`
  )

  return [horizontal, headerLine, horizontal, ...rowLines, horizontal].join('\n')
}
