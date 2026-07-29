interface Props {
  /** Root crumb label (e.g. "Videos" or "History"). */
  rootLabel: string;
  /** Current page label. */
  current: string;
  onRoot: () => void;
}

/** Simple two-level breadcrumb for navigating back to the list/root. */
export function Breadcrumb({ rootLabel, current, onRoot }: Props) {
  return (
    <nav class="breadcrumb">
      <button class="crumb-link" onClick={onRoot}>
        {rootLabel}
      </button>
      <span class="crumb-sep">›</span>
      <span class="crumb-current">{current}</span>
    </nav>
  );
}
