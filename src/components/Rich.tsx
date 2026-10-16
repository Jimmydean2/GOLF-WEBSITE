import { richParts } from "@/lib/i18n/rich";

// Renders a translated sentence that marks some words bold (see lib/i18n/rich.ts) as React.
export default function Rich({ text, strongClassName = "text-ink" }: { text: string; strongClassName?: string }) {
  return (
    <>
      {richParts(text).map((part, i) =>
        part.bold ? (
          <strong key={i} className={strongClassName}>
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
