import { qualifyName, quoteIdentifier } from "../../sqlIdentifiers";
import type { DatabaseObjectDetails } from "../../types";

function buildColumnSchema(
  column: DatabaseObjectDetails["columns"][number],
  primaryKeyColumns: string[],
) {
  const parts = [`${quoteIdentifier(column.name)} ${column.dataType}`];

  if (!column.nullable) {
    parts.push("NOT NULL");
  }

  if (primaryKeyColumns.length === 1 && primaryKeyColumns[0] === column.name) {
    parts.push("PRIMARY KEY");
  }

  return parts.join(" ");
}

export function buildObjectSchema(details: DatabaseObjectDetails | null) {
  if (!details) return "";

  const qualifiedName = qualifyName(details.schema, details.name);
  const primaryKeyColumns = details.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name);

  if (details.kind === "view") {
    const viewColumns = details.columns
      .map((column) => `  ${quoteIdentifier(column.name)}`)
      .join(",\n");

    return [
      `CREATE VIEW ${qualifiedName} AS`,
      "SELECT",
      viewColumns || "  *",
      `FROM ${qualifiedName};`,
    ].join("\n");
  }

  const columnSchemas = details.columns.map(
    (column) => `  ${buildColumnSchema(column, primaryKeyColumns)}`,
  );

  if (primaryKeyColumns.length > 1) {
    columnSchemas.push(
      `  PRIMARY KEY (${primaryKeyColumns.map((column) => quoteIdentifier(column)).join(", ")})`,
    );
  }

  const indexSchemas = details.indexes
    .filter((index) => !index.primary)
    .map((index) => {
      const unique = index.unique ? "UNIQUE " : "";
      const columns = index.columns.map((column) => quoteIdentifier(column)).join(", ");
      return `CREATE ${unique}INDEX ${quoteIdentifier(index.name)} ON ${qualifiedName} (${columns});`;
    });

  return [
    `CREATE TABLE ${qualifiedName} (`,
    `${columnSchemas.join(",\n")}`,
    ");",
    ...(indexSchemas.length > 0 ? ["", ...indexSchemas] : []),
  ].join("\n");
}
