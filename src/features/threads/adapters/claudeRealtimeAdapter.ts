import type { RealtimeAdapter } from "../contracts/conversationCurtainContracts";
import { mapCommonRealtimeEvent } from "./sharedRealtimeAdapter";

export const claudeRealtimeAdapter: RealtimeAdapter = {
  engine: "claude",
  mapEvent(input: unknown) {
    return mapCommonRealtimeEvent("claude", input, {
      allowTextDeltaAlias: true,
    });
  },
};
