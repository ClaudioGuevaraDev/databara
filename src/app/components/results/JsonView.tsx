import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { exportQueryResultJson } from "../../query/exportJson";
import type { QueryResult } from "../../types";
import { EmptyPanel } from "../ui";

type JsonTone = "key" | "string" | "number" | "boolean" | "null" | "punct";

// Matches one JSON token at a time: strings, numbers, the literals, or structural
// punctuation. Whitespace/indentation falls in the gaps between matches.
const TOKEN_RE =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g;

function classify(token: string, source: string, end: number): JsonTone {
  if (token[0] === '"') {
    // A string acts as a key only when the next non-space character is a colon.
    let i = end;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    return source[i] === ":" ? "key" : "string";
  }
  if (token === "true" || token === "false") return "boolean";
  if (token === "null") return "null";
  if (/^[{}[\],:]$/.test(token)) return "punct";
  return "number";
}

function toneClass(tone: JsonTone): string {
  switch (tone) {
    case "key":
      return "text-[hsl(188_70%_32%)] dark:text-[hsl(188_72%_72%)]";
    case "string":
      return "text-[hsl(150_50%_30%)] dark:text-[hsl(150_52%_66%)]";
    case "number":
      return "text-[hsl(22_85%_42%)] dark:text-[hsl(22_95%_72%)]";
    case "boolean":
      return "font-semibold text-[hsl(280_55%_45%)] dark:text-[hsl(280_62%_75%)]";
    case "null":
      return "italic text-[hsl(215_16%_45%)] dark:text-[hsl(215_16%_58%)]";
    default:
      return "text-[hsl(215_16%_45%)] dark:text-[hsl(215_16%_58%)]";
  }
}

function renderJson(json: string) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(json)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > cursor) {
      nodes.push(<span key={`gap-${cursor}`}>{json.slice(cursor, start)}</span>);
    }
    const tone = classify(token, json, start + token.length);
    nodes.push(
      <span key={`tok-${start}`} className={toneClass(tone)}>
        {token}
      </span>,
    );
    cursor = start + token.length;
  }

  if (cursor < json.length) {
    nodes.push(<span key={`gap-${cursor}`}>{json.slice(cursor)}</span>);
  }

  return nodes;
}

export function JsonView({
  queryResult,
  onCopy,
}: {
  queryResult: QueryResult | null;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!queryResult || queryResult.columns.length === 0)
    return <EmptyPanel text={t("results.emptyGrid")} />;

  // Same serializer the JSON download uses, so both stay in sync.
  const json = exportQueryResultJson(queryResult);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full overflow-auto bg-[hsl(var(--panel-soft)/0.2)] p-3">
      <div className="relative min-h-full rounded-md border border-border/70 bg-[hsl(var(--panel-soft)/0.74)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03),0_10px_24px_hsl(var(--shadow-strong)/0.18)]">
        <button
          type="button"
          onClick={handleCopy}
          title={t("results.copyJson")}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <pre className="min-h-full overflow-auto p-3 font-mono text-[12px] leading-6 text-[hsl(215_20%_32%)] dark:text-[hsl(215_20%_78%)]">
          <code>{renderJson(json)}</code>
        </pre>
      </div>
    </div>
  );
}
