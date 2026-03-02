/**
 * Chains Tab - Chain management and monitoring
 */

import React from 'react';
import { ChainManagementControls } from '../ChainManagementControls';

interface Chain {
  sessionId: string;
  phase: 'ENTRY' | 'EXIT';
  chainId: string;
  index: number;
  state: 'ACTIVE' | 'STALLED' | 'COMPLETED';
  lastHolder?: string;
  lastSeq: number;
  lastAt?: number;
}

interface ChainsTabProps {
  sessionId: string;
  chains: Chain[];
  stalledChains: string[];
  onChainsUpdated: () => void;
  onError: (error: string) => void;
}

export const ChainsTab: React.FC<ChainsTabProps> = ({
  sessionId,
  chains,
  stalledChains,
  onChainsUpdated,
  onError,
}) => {
  return (
    <div>
      <ChainManagementControls
        sessionId={sessionId}
        chains={chains as any}
        stalledChains={stalledChains}
        onChainsUpdated={onChainsUpdated}
        onError={onError}
      />
    </div>
  );
};
