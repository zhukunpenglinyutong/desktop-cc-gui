import { createContext, useContext } from "react";

/** Whether the enclosing MessageTimeline is currently visible in its keep-alive
 *  stack. Defaults to true for standalone renders outside a timeline. */
export const TimelineVisibleContext = createContext(true);

export function useTimelineVisible(): boolean {
  return useContext(TimelineVisibleContext);
}
