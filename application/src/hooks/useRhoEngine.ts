import { useEffect, useCallback } from "react";
import { rhoClient } from "../lib/rpc";
import { useSessionStore } from "../store/sessionStore";
import { useProviderStore } from "../store/providerStore";
import { useSubagentStore } from "../store/subagentStore";
import { RpcCommand, RpcResponse } from "../lib/protocol";

export function useRhoEngine() {
  const handleEvent = useSessionStore((s) => s.handleEvent);

  useEffect(() => {
    const unsub = rhoClient.onEvent(handleEvent);
    return () => unsub();
  }, [handleEvent]);

  const send = useCallback(async (command: RpcCommand): Promise<RpcResponse> => {
    return rhoClient.sendCommand(command);
  }, []);

  const prompt = useCallback((message: string, webSearch?: boolean) => {
    const { activeModel, activeProviderId, preambles, activePreambleId } = useProviderStore.getState();
    const { activeChatAgentId, subagents } = useSubagentStore.getState();
    const activeAgent = subagents?.find((a) => a.id === activeChatAgentId);

    let preambleText: string | undefined;
    if (activeAgent?.systemPrompt?.trim()) {
      preambleText = activeAgent.systemPrompt.trim();
    } else {
      const activePreamble = preambles?.find((p) => p.id === activePreambleId);
      preambleText = activePreamble?.content?.trim() || undefined;
    }

    return rhoClient.prompt(message, activeModel, activeProviderId, preambleText, webSearch);
  }, []);

  const steer = useCallback((message: string) => {
    return rhoClient.steer(message);
  }, []);

  const abort = useCallback(() => {
    return rhoClient.abort();
  }, []);

  const respondToTool = useCallback((approvalId: string, decision: "allow" | "deny") => {
    return rhoClient.respondToTool(approvalId, decision);
  }, []);

  return {
    send,
    prompt,
    steer,
    abort,
    respondToTool,
  };
}
