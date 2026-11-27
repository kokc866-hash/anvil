import { useEffect, useState } from "react";
import { useIde } from "@/store/ide";

/** Keep unsent attachments in memory when the same chat moves between panes. */
export function useChatComposerDraft() {
  const [images, setImages] = useState<string[]>([]);
  const [delivery, setDelivery] = useState<"queue" | "steer">("queue");
  useEffect(() => useIde.subscribe((s, prev) => {
    if (s.workspaceEpoch !== prev.workspaceEpoch || s.memoryWorkspace !== prev.memoryWorkspace || (s.chat !== prev.chat && !s.chat.length)) {
      setImages([]);
      setDelivery("queue");
    }
  }), []);
  return { images, setImages, delivery, setDelivery };
}
