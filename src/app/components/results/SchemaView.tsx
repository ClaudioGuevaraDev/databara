import { Check, Copy } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import type { DatabaseObjectDetails } from "../../types";
import { EmptyPanel } from "../ui";
import { buildObjectSchema } from "./objectSchema";

type SqlTokenTone = "keyword" | "type" | "identifier" | "muted" | "plain";

function renderSql(sql: string) {
  const lines = sql.split("\n");

  return lines.map((line, lineIndex) => {
    const tokens = line.match(/"[^"]*"|\b[A-Za-z_][A-Za-z0-9_]*\b|[.,();*]/g) ?? [];
    const renderedTokens: ReactNode[] = [];
    let cursor = 0;

    for (const token of tokens) {
      const start = line.indexOf(token, cursor);
      if (start > cursor) {
        renderedTokens.push(
          <span
            key={`${lineIndex}-${cursor}-gap`}
            className="text-[hsl(215_20%_35%)] dark:text-[hsl(215_20%_72%)]"
          >
            {line.slice(cursor, start)}
          </span>,
        );
      }

      renderedTokens.push(
        <span
          key={`${lineIndex}-${start}-${token}`}
          className={tokenToneClass(getTokenTone(token))}
        >
          {token}
        </span>,
      );
      cursor = start + token.length;
    }

    if (cursor < line.length) {
      renderedTokens.push(
        <span
          key={`${lineIndex}-${cursor}-tail`}
          className="text-[hsl(215_20%_35%)] dark:text-[hsl(215_20%_72%)]"
        >
          {line.slice(cursor)}
        </span>,
      );
    }

    return (
      // Keyed by position only: including the line text remounted every line
      // whose content changed.
      <div key={lineIndex} className="whitespace-pre">
        {renderedTokens.length > 0 ? renderedTokens : <span>&nbsp;</span>}
      </div>
    );
  });
}

function getTokenTone(token: string): SqlTokenTone {
  const normalized = token.toUpperCase();

  if (
    [
      "AS",
      "CREATE",
      "FROM",
      "INDEX",
      "NOT",
      "NULL",
      "ON",
      "PRIMARY",
      "KEY",
      "SELECT",
      "TABLE",
      "UNIQUE",
      "VIEW",
    ].includes(normalized)
  ) {
    return "keyword";
  }

  if (
    [
      "BIGINT",
      "BOOLEAN",
      "DATE",
      "INTEGER",
      "JSON",
      "JSONB",
      "TEXT",
      "TIMESTAMPTZ",
      "UUID",
    ].includes(normalized)
  ) {
    return "type";
  }

  if (
    token === "." ||
    token === "," ||
    token === "(" ||
    token === ")" ||
    token === ";" ||
    token === "*"
  ) {
    return "muted";
  }

  if (token.startsWith('"') && token.endsWith('"')) {
    return "identifier";
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
    return "identifier";
  }

  return "plain";
}

function tokenToneClass(tone: SqlTokenTone) {
  switch (tone) {
    case "keyword":
      return "font-semibold text-[hsl(22_85%_42%)] dark:text-[hsl(22_95%_72%)]";
    case "type":
      return "text-[hsl(188_70%_32%)] dark:text-[hsl(188_72%_72%)]";
    case "identifier":
      return "text-[hsl(215_28%_28%)] dark:text-[hsl(210_20%_92%)]";
    case "muted":
      return "text-[hsl(215_16%_45%)] dark:text-[hsl(215_16%_58%)]";
    default:
      return "text-[hsl(215_20%_32%)] dark:text-[hsl(215_20%_78%)]";
  }
}

export function SchemaView({
  details,
  onCopy,
}: {
  details: DatabaseObjectDetails | null;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  // The schema build + tokenizer used to re-run on every render; both depend
  // only on `details`.
  const schemaSql = useMemo(() => (details ? buildObjectSchema(details) : ""), [details]);
  const schemaNodes = useMemo(() => renderSql(schemaSql), [schemaSql]);

  if (!details) return <EmptyPanel text={t("results.emptySchema")} />;

  const badgeSurfaceClass = "bg-[hsl(var(--panel-soft)/0.74)]";

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full overflow-auto bg-[hsl(var(--panel-soft)/0.2)] p-3">
      <div
        className={`relative min-h-full rounded-md border border-border/70 ${badgeSurfaceClass} shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03),0_10px_24px_hsl(var(--shadow-strong)/0.18)]`}
      >
        <button
          type="button"
          onClick={handleCopy}
          title={t("results.copySchema")}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <pre className="min-h-full overflow-auto p-3 font-mono text-[12px] leading-6">
          <code>{schemaNodes}</code>
        </pre>
      </div>
    </div>
  );
}
