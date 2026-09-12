import React from 'react';
import { ShieldAlert, CheckCircle2, XCircle, Terminal, FileCode2, Globe, KeyRound } from 'lucide-react';

export interface HitlRequest {
  requestId: string;
  actionType: 'shell_execution' | 'file_mutation' | 'network_egress' | 'secret_access';
  description: string;
  detailsJson: string;
  requestedBy: string;
  createdAtUnix: number;
}

interface HitlApprovalCardProps {
  request: HitlRequest;
  onApprove: (requestId: string, allowAlways: boolean) => void;
  onDeny: (requestId: string) => void;
}

export const HitlApprovalCard: React.FC<HitlApprovalCardProps> = ({
  request,
  onApprove,
  onDeny,
}) => {
  const getIcon = () => {
    switch (request.actionType) {
      case 'shell_execution':
        return <Terminal className="w-5 h-5 text-amber-400" />;
      case 'file_mutation':
        return <FileCode2 className="w-5 h-5 text-blue-400" />;
      case 'network_egress':
        return <Globe className="w-5 h-5 text-purple-400" />;
      case 'secret_access':
        return <KeyRound className="w-5 h-5 text-red-400" />;
      default:
        return <ShieldAlert className="w-5 h-5 text-amber-400" />;
    }
  };

  const isSecret = request.actionType === 'secret_access';

  return (
    <div className={`bg-zinc-900/90 border ${isSecret ? 'border-red-500/40 shadow-red-500/5' : 'border-amber-500/30 shadow-amber-500/5'} rounded-xl p-4 my-3 shadow-lg backdrop-blur-sm`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          {getIcon()}
          <span className={`text-xs font-semibold uppercase tracking-wider ${isSecret ? 'text-red-400' : 'text-amber-400'}`}>
            {isSecret ? 'Secret Shield Required' : 'Permission Required (HITL)'}
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">
          Agent: {request.requestedBy}
        </span>
      </div>

      <p className="text-sm font-medium text-zinc-200 mb-2">
        {request.description}
      </p>

      {request.detailsJson && (
        <div className="bg-black/50 rounded-lg p-2.5 mb-3 border border-zinc-800 font-mono text-xs text-zinc-400 overflow-x-auto">
          {request.detailsJson}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onApprove(request.requestId, false)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-medium transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Approve Once
        </button>

        <button
          onClick={() => onApprove(request.requestId, true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          Always Allow in Session
        </button>

        <button
          onClick={() => onDeny(request.requestId)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors ml-auto"
        >
          <XCircle className="w-3.5 h-3.5" />
          Deny
        </button>
      </div>
    </div>
  );
};
