/**
 * Parses the planner json.
 * @param response - the response argument.
 * @returns the computed result.
 */
export function parsePlannerJson(response: string): unknown {
  const trimmed = response.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced?.[1]) {
    return JSON.parse(fenced[1])
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new Error('Workflow planner did not return JSON graph expansion data')
}

/**
 * Iss the record.
 * @param value - the value argument.
 * @returns the computed result.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeLooseFieldKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Reads the loose value.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLooseValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }

  const normalizedKeys = new Set(keys.map(normalizeLooseFieldKey).filter(Boolean))
  if (normalizedKeys.size === 0) return undefined

  for (const [key, value] of Object.entries(record)) {
    if (normalizedKeys.has(normalizeLooseFieldKey(key))) {
      return value
    }
  }
  return undefined
}

/**
 * Reads the loose array.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLooseArray(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown[] | undefined {
  const value = readLooseValue(record, keys)
  return Array.isArray(value) ? value : undefined
}

/**
 * Reads the loose string.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLooseString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  return stringValue(readLooseValue(record, keys))
}

/**
 * Reads the loose string array.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLooseStringArray(
  record: Record<string, unknown>,
  keys: readonly string[],
): string[] | undefined {
  const value = readLooseValue(record, keys)
  if (!Array.isArray(value)) return undefined
  return value.map(stringValue).filter((item): item is string => item !== undefined)
}

/**
 * Reads the loose boolean.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLooseBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  const value = readLooseValue(record, keys)
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Reads the loose positive integer.
 * @param record - the record argument.
 * @param keys - the keys argument.
 * @returns the computed result.
 */
export function readLoosePositiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const value = readLooseValue(record, keys)
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Handles the string value.
 * @param value - the value argument.
 * @returns the computed result.
 */
export function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
