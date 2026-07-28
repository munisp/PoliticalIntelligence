import { useEffect, useRef } from "react";

/**
 * a11y: remember the element that had focus before a modal/drawer opened and
 * return focus to it when the dialog closes (or unmounts). Radix dialogs do
 * this internally; the hand-rolled drawers/modals (EvidenceDrawer,
 * GenerateModal, CitationTraceModal) use this hook instead.
 *
 * The previously-focused element is captured during the render in which
 * `open` flips true — i.e. BEFORE the dialog's mount effects/ref callbacks
 * can move focus into the surface. (A passive-effect capture would already
 * see the dialog's close button as document.activeElement.) The dialog is
 * still responsible for moving focus INTO the surface on open.
 */
export function useFocusReturn(open: boolean) {
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  if (open && !wasOpenRef.current) {
    // Render-phase capture on the closed → open transition.
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    return () => {
      const el = restoreRef.current;
      restoreRef.current = null;
      // Only restore if the element is still in the document.
      if (el && el.isConnected) el.focus();
    };
  }, [open]);
}
