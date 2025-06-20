import React, { createContext, useContext, useEffect, useState } from 'react';
import { db, callJoinLobby, callPlayerAction, callRequestRefund, callTriggerGameProcessing } from '../../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Player {
  address: string;
  name?: string;
  status: 'alive' | 'eliminated';
  responseTime?: number;
  lastActionRound?: number;
  isNpc?: boolean;
  joinedAt?: Timestamp;
  solPaid?: number;
  transactionSignature?: string;
  refundRequested?: boolean;
  lastActionAt?: Timestamp;
  clientTimestamp?: number;
}

export interface GameData {
  gameId?: string;
  status: 'waiting' | 'lobby' | 'starting' | 'in_progress' | 'completed' | 'ended' | 'cancelled';
  playerCount: number;
  maxPlayers: number;
  players: { [key: string]: Player };
  round: number;
  roundDurationSec: number;
  roundStartedAt?: Timestamp;
  countdownDuration: number;
  countdownStartedAt?: Timestamp | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  totalSolCollected?: number;
  entryFeeSol?: number;
  ballTokenMint?: string;
  tokenSymbol?: string;
  payments?: any[];
  winner?: string;
  completedAt?: Timestamp;
  statusMessage?: string;
  swappingInProgress?: boolean;
  prizeTokensReady?: boolean;
  swappedTokenAmount?: number;
  swapSignature?: string;
  swapCompletedAt?: Timestamp;
  swapError?: string;
  swapFailedAt?: Timestamp;
  prize?: {
    prizeAmountFormatted?: string;
    tokenSymbol?: string;
    rawAmount?: number;
    solCollected?: number;
    transferSignature?: string;
    transferSuccess?: boolean;
    processing?: boolean;
    status?: string;
    error?: string;
    completedAt?: Timestamp;
    failedAt?: Timestamp;
    preSwapped?: boolean;
    swapSignature?: string;
  };
}

interface JoinLobbyResponse {
  success: boolean;
  requiresPayment?: boolean;
  entryFee?: number;
  treasuryAddress?: string;
  message?: string;
  gameId?: string;
  paymentVerified?: boolean;
  playerCount?: number;
  maxPlayers?: number;
  status?: string;
  isNewGame?: boolean;
  transactionSignature?: string;
}

interface PlayerActionParams {
  gameId: string;
  playerAddress: string;
  clientTimestamp: number;
  clientResponseTime: number;
  roundStartTime: number;
  buttonAppearanceTime?: number;
}

interface PlayerActionResponse {
  success: boolean;
  message: string;
  round: number;
  responseTime: number;
}

interface RefundResponse {
  success: boolean;
  message: string;
  refundAmount?: number;
  refundSignature?: string;
  newPlayerCount?: number;
  newStatus?: string;
}

// CLEAN: Only the essential functions we actually need
interface GameContextValue {
  gameData: GameData | null;
  gameId: string | null;
  setGameId: (gameId: string | null) => void;
  setGameData: (gameData: GameData | null) => void;
  joinLobby: (playerAddress: string, transactionSignature?: string) => Promise<JoinLobbyResponse>;
  playerAction: (params: PlayerActionParams) => Promise<PlayerActionResponse>;
  requestRefund: (gameId: string, playerAddress: string) => Promise<RefundResponse>;
  triggerGameProcessing: (gameId: string) => Promise<void>;
}

// ============================================================================
// GAME CONTEXT
// ============================================================================

const GameContext = createContext<GameContextValue | undefined>(undefined);

export const GameProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);

  // CLEAN: Simple Firestore real-time listener (no processing logic)
  useEffect(() => {
    if (!gameId) {
      setGameData(null);
      return;
    }

    console.log(`🔄 Subscribing to game: ${gameId}`);
    
    const unsubscribe = onSnapshot(
      doc(db, 'games', gameId), 
      (snapshot) => {
        if (snapshot.exists()) {
          const newGameData = snapshot.data() as GameData;
          
          // Just update the state - no processing logic!
          setGameData(newGameData);
          
          console.log(`📊 Game ${gameId} updated:`, {
            status: newGameData.status,
            round: newGameData.round,
            playerCount: newGameData.playerCount,
            winner: newGameData.winner
          });
        } else {
          console.log(`❌ Game ${gameId} not found`);
          setGameData(null);
        }
      },
      (error) => {
        console.error(`❌ Error listening to game ${gameId}:`, error);
      }
    );

    return () => {
      console.log(`🔌 Unsubscribing from game: ${gameId}`);
      unsubscribe();
    };
  }, [gameId]);

  // ============================================================================
  // CORE FUNCTIONS - Clean & Simple
  // ============================================================================

  const joinLobby = async (
    playerAddress: string, 
    transactionSignature?: string
  ): Promise<JoinLobbyResponse> => {
    try {
      console.log(`🎮 Joining lobby: ${playerAddress}${transactionSignature ? ' (with payment)' : ''}`);
      
      const response = await callJoinLobby(playerAddress, transactionSignature);
      const data = response.data as JoinLobbyResponse;
      
      // Set gameId if join was successful
      if (data.success && data.gameId) {
        setGameId(data.gameId);
        console.log(`✅ Successfully joined game: ${data.gameId}`);
      }
      
      return data;
    } catch (error: any) {
      console.error('❌ Join lobby error:', error);
      throw new Error(error?.message || 'Failed to join lobby');
    }
  };

  const playerAction = async (params: PlayerActionParams): Promise<PlayerActionResponse> => {
    try {
      console.log(`⚡ Recording player action:`, {
        gameId: params.gameId,
        player: params.playerAddress.slice(0, 8),
        responseTime: params.clientResponseTime
      });
      
      const response = await callPlayerAction(params);
      const data = response.data as PlayerActionResponse;
      
      console.log(`✅ Player action recorded successfully`);
      return data;
    } catch (error: any) {
      console.error('❌ Player action error:', error);
      throw new Error(error?.message || 'Failed to record player action');
    }
  };

  const requestRefund = async (
    gameId: string, 
    playerAddress: string
  ): Promise<RefundResponse> => {
    try {
      console.log(`💰 Requesting refund for ${playerAddress} in game ${gameId}`);
      
      const response = await callRequestRefund(gameId, playerAddress);
      const data = response.data as RefundResponse;
      
      if (data.success) {
        console.log(`✅ Refund request successful: ${data.refundAmount} SOL`);
        // Game state will update via Firestore listener
      }
      
      return data;
    } catch (error: any) {
      console.error('❌ Refund request error:', error);
      throw new Error(error?.message || 'Failed to request refund');
    }
  };

  const triggerGameProcessing = async (gameId: string): Promise<void> => {
    try {
      console.log(`🎯 Triggering game processing for game: ${gameId}`);
      
      await callTriggerGameProcessing(gameId);
      
      console.log(`✅ Game processing triggered successfully`);
    } catch (error: any) {
      console.error('❌ Game processing error:', error);
      throw new Error(error?.message || 'Failed to trigger game processing');
    }
  };

  // Manual state setters (for edge cases like "Play Again")
  const handleSetGameId = (newGameId: string | null) => {
    console.log(`🎯 Setting gameId: ${newGameId || 'null'}`);
    setGameId(newGameId);
  };

  const handleSetGameData = (newGameData: GameData | null) => {
    console.log(`📊 Manually setting gameData:`, newGameData?.status || 'null');
    setGameData(newGameData);
  };

  // ============================================================================
  // CONTEXT PROVIDER
  // ============================================================================

  const contextValue: GameContextValue = {
    gameId,
    gameData,
    setGameId: handleSetGameId,
    setGameData: handleSetGameData,
    joinLobby,
    playerAction,
    requestRefund,
    triggerGameProcessing
  };

  return (
    <GameContext.Provider value={contextValue}>
      {children}
    </GameContext.Provider>
  );
};

// ============================================================================
// CUSTOM HOOK
// ============================================================================

export const useGame = (): GameContextValue => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

// ============================================================================
// UTILITY FUNCTIONS (if needed elsewhere)
// ============================================================================

export const getPlayerStatus = (gameData: GameData | null, playerAddress: string): string => {
  if (gameData?.players?.[playerAddress]) {
    return gameData.players[playerAddress].status;
  }
  return 'unknown';
};

export const getAlivePlayers = (gameData: GameData | null): Player[] => {
  if (!gameData?.players) return [];
  return Object.values(gameData.players).filter(p => p.status === 'alive');
};

export const getPlayerRankings = (gameData: GameData | null): (Player & { address: string; displayName: string })[] => {
  if (!gameData?.players) return [];
  
  return Object.entries(gameData.players)
    .map(([address, player]) => ({
      ...player,
      address,
      displayName: `${address.slice(0, 4)}...${address.slice(-4)}`
    }))
    .sort((a, b) => {
      // Alive players first, then by response time (fastest first)
      if (a.status !== b.status) {
        return a.status === 'alive' ? -1 : 1;
      }
      if (a.responseTime && b.responseTime) {
        return a.responseTime - b.responseTime;
      }
      return 0;
    });
};