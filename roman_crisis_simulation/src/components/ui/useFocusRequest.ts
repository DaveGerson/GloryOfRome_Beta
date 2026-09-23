import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus that follows a swap. Several confirms on this client replace the
 * button that was just pressed ("Restore from a copy" becomes Replace / Keep
 * my reign; "Start anew" becomes Abandon / Keep my reign, and back again).
 * Unmounting a focused button drops focus to <body>: a keyboard player loses
 * their place, and inside a dialog its Escape and Tab trap stop hearing them.
 *
 * Call the returned function from the event handler that causes the swap,
 * naming the element that should hold focus once it has rendered; the move
 * happens after that commit. One pending request at a time - the latest wins.
 */
export function useFocusRequest(): (target: RefObject<HTMLElement | null>) => void {
  const pendingRef = useRef<RefObject<HTMLElement | null> | null>(null);

  // Deliberately dependency-free: it must run after whichever commit renders
  // the target, and is a single null check on every other commit.
  useEffect(() => {
    const target = pendingRef.current;
    if (!target) return;
    pendingRef.current = null;
    target.current?.focus();
  });

  return target => {
    pendingRef.current = target;
  };
}
