import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";

export function useFocusId(): number | null {
  const search = useSearch();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get("focus");
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [search]);
}

export function useFocusRow<T extends { id: number }>(
  filteredRows: ReadonlyArray<T> | undefined,
  options: { existsById: boolean },
) {
  const focusId = useFocusId();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const handledRef = useRef<number | null>(null);

  const visibleInFiltered = !!(
    focusId && filteredRows?.some((r) => r.id === focusId)
  );
  const notVisibleButExists =
    !!focusId && options.existsById && !visibleInFiltered;

  useEffect(() => {
    if (!focusId) return;
    if (!visibleInFiltered) return;
    if (handledRef.current === focusId) return;
    handledRef.current = focusId;

    const el = rowRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedId(focusId);
    const t = window.setTimeout(() => setHighlightedId(null), 2200);
    return () => window.clearTimeout(t);
  }, [focusId, visibleInFiltered]);

  function rowProps(id: number) {
    return {
      ref: id === focusId ? rowRef : undefined,
      "data-focused": id === highlightedId ? "true" : undefined,
      className:
        id === highlightedId
          ? "ring-2 ring-primary bg-primary/5 transition-colors"
          : "",
    };
  }

  return { focusId, notVisibleButExists, rowProps };
}
