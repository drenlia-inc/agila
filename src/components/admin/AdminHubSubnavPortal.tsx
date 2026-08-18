import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const AdminHubSubnavSlotContext = createContext<React.RefObject<HTMLDivElement | null> | null>(
  null,
);

export function AdminHubSubnavSlotProvider({
  slotRef,
  children,
}: {
  slotRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  return (
    <AdminHubSubnavSlotContext.Provider value={slotRef}>{children}</AdminHubSubnavSlotContext.Provider>
  );
}

/** Renders hub sub-nav into the sticky Admin chrome (System / App settings). */
export function AdminHubSubnavPortal({ children }: { children: React.ReactNode }) {
  const slotRef = useContext(AdminHubSubnavSlotContext);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setSlot(slotRef?.current ?? null);
  }, [slotRef]);

  if (!slot) return null;

  return createPortal(children, slot);
}
