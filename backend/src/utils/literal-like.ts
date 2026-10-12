/** Use with LIKE ? ESCAPE '!': the whole input is one literal substring. */
export function literalSubstringPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, '!$&')}%`;
}
