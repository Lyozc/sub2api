export function isValidKlingApiKey(value: string): boolean {
  const separator = value.indexOf('|')
  return separator > 0 && Boolean(value.slice(0, separator).trim() && value.slice(separator + 1).trim())
}
