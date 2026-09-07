import { useCallback } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useRhoEngine } from "./useRhoEngine";

export function useToolApproval() {
  const { respondToTool } = useRhoEngine();
  const pendingApproval = useSessionStore((s) => s.pendingApproval);
  const clearPendingApproval = useSessionStore((s) => s.clearPendingApproval);

  const approve = useCallback(async () => {
    if (!pendingApproval) return;
    await respondToTool(pendingApproval.approvalId, "allow");
    clearPendingApproval();
  }, [pendingApproval, respondToTool, clearPendingApproval]);

  const reject = useCallback(async () => {
    if (!pendingApproval) return;
    await respondToTool(pendingApproval.approvalId, "deny");
    clearPendingApproval();
  }, [pendingApproval, respondToTool, clearPendingApproval]);

  return {
    isWaiting: Boolean(pendingApproval),
    pendingApproval,
    approve,
    reject,
  };
}
