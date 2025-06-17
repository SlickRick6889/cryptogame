import React, { createContext, useContext, useEffect, useState } from 'react';
import { db, callJoinLobby, callPlayerAction, callRequestRefund, callFastGameTick } from '../../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

// Define types
export interface Player {
  address: string;
  name?: string;
  status: string;
  responseTime?: number;
  lastActionRound?: number;
}

export interface GameData {
  gameId: string;
  status: 'waiting' | 'lobby' | 'starting' | 'in_progress' | 'completed' | 'ended';
  playerCount: number;
  maxPlayers: number;
  players: { [key: string]: { status: 'alive' | 'eliminated' } };
  round: number;
  roundDurationSec: number;
  roundStartedAt: Timestamp;
  countdownDuration: number;
  countdownStartedAt: Timestamp;
  prize?: { prizeAmountFormatted: string; tokenSymbol: string };
  winner?: string;
  statusMessage?: string;
}

interface GameContextValue {
  gameData: GameData | null;
  gameId: string | null;
  joinLobby: (playerAddress: string, transactionSignature?: string) => Promise<any>;
  playerAction: (params: {
    gameId: string;
    playerAddress: string;
    clientTimestamp: number;
    clientResponseTime: number;
    roundStartTime: number;
  }) => Promise<any>;
  requestRefund: (gameId: string, playerAddress: string) => Promise<any>;
  fastGameTick: () => Promise<any>;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

export const GameProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);

  // Subscribe to game document
  useEffect(() => {
    if (!gameId) return;
    const unsubscribe = onSnapshot(doc(db, 'games', gameId), snapshot => {
      if (snapshot.exists()) {
        setGameData(snapshot.data() as GameData);
      }
    });
    return () => unsubscribe();
  }, [gameId]);

  const joinLobbyFn = async (playerAddress: string, transactionSignature?: string) => {
    const res = await callJoinLobby(playerAddress, transactionSignature);
    const data = res.data;
    if (data.success && data.gameId) {
      setGameId(data.gameId);
    }
    return data;
  };

  const playerActionFn = async (params: {
    gameId: string;
    playerAddress: string;
    clientTimestamp: number;
    clientResponseTime: number;
    roundStartTime: number;
  }) => {
    const res = await callPlayerAction(params);
    return res.data;
  };

  const requestRefundFn = async (gameId: string, playerAddress: string) => {
    const res = await callRequestRefund(gameId, playerAddress);
    return res.data;
  };

  const fastGameTickFn = async () => {
    const res = await callFastGameTick();
    return res.data;
  };

  return (
    <GameContext.Provider value={{ gameId, gameData, joinLobby: joinLobbyFn, playerAction: playerActionFn, requestRefund: requestRefundFn, fastGameTick: fastGameTickFn }}>
      {children}
    </GameContext.Provider>
  );
};

export const useGame = (): GameContextValue => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}; 