/** Quotes a SQL identifier only when it is not a plain lowercase identifier, so that
 * mixed-case / camelCase names (which PostgreSQL would otherwise fold to lowercase)
 * survive. Embedded double quotes are escaped by doubling them. */
export function quoteIdentifier(identifier: string) {
  if (/^[a-z_][a-z0-9_]*$/.test(identifier)) return identifier;
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Builds a `schema.name` reference with each part quoted only when needed. */
export function qualifyName(schema: string, name: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}
