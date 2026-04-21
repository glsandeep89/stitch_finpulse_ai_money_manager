import type { ReactNode } from "react";
import type { AiOutputRow } from "../../lib/aiOutputs";

function formatWhen(iso: string | undefined) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

type Props = {
  row: AiOutputRow;
  /** Optional override for card heading */
  label?: string;
  children?: ReactNode;
};

export function AiOutputCard({ row, label, children }: Props) {
  return (
    <article
      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 shadow-ambient"
      aria-label={row.title}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-headline text-sm font-semibold text-on-surface">{label ?? row.title}</h3>
        <span className="text-[10px] text-on-surface-variant whitespace-nowrap">
          {formatWhen(row.generated_at)}
        </span>
      </div>
      <p className="text-sm text-on-surface-variant font-body">{row.summary}</p>
      {children}
    </article>
  );
}

export function AiOutputEmpty({ message }: { message: string }) {
  return <p className="text-xs text-on-surface-variant font-body">{message}</p>;
}
