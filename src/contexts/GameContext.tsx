'use client';

import React, { createContext, useContext, useReducer, useEffect } from 'react';

// Game types
export type GamePhase = 'lobby' | 'playing' | 'results';
export type PlayerStatus = 'alive' | 'eliminated';

export interface Player {
  id: string;
  wallet: string;
  name: string;
  avatar?: string;
  status: PlayerStatus;
  isNPC?: boolean;
  personality?: string;
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentRound: number;
  maxRounds: number;
  prizePool: number;
  entryFee: number;
  roundTimer: number;
  isDemo: boolean;
  winner?: Player;
}

// Game actions
type GameAction =
  | { type: 'JOIN_GAME'; payload: { player: Player } }
  | { type: 'START_GAME' }
  | { type: 'NEXT_ROUND' }
  | { type: 'ELIMINATE_PLAYER'; payload: { playerId: string } }
  | { type: 'END_GAME'; payload: { winner: Player } }
  | { type: 'TICK_TIMER' }
  | { type: 'RESET_GAME' };

// Initial state
const initialState: GameState = {
  phase: 'lobby',
  players: [],
  currentRound: 0,
  maxRounds: 10,
  prizePool: 0,
  entryFee: 0.1, // SOL
  roundTimer: 30,
  isDemo: true, // Always demo mode for now
};

// Game reducer
function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'JOIN_GAME':
      return {
        ...state,
        players: [...state.players, action.payload.player],
        prizePool: state.prizePool + 1000, // 1000 STAY tokens per player
      };

    case 'START_GAME':
      return {
        ...state,
        phase: 'playing',
        currentRound: 1,
        roundTimer: 30,
      };

    case 'NEXT_ROUND':
      return {
        ...state,
        currentRound: state.currentRound + 1,
        roundTimer: 30,
      };

    case 'ELIMINATE_PLAYER':
      const updatedPlayers = state.players.map(player =>
        player.id === action.payload.playerId
          ? { ...player, status: 'eliminated' as PlayerStatus }
          : player
      );
      
      const alivePlayers = updatedPlayers.filter(p => p.status === 'alive');
      
      // Check if game should end
      if (alivePlayers.length <= 1) {
        return {
          ...state,
          players: updatedPlayers,
          phase: 'results',
          winner: alivePlayers[0],
        };
      }
      
      return {
        ...state,
        players: updatedPlayers,
      };

    case 'END_GAME':
      return {
        ...state,
        phase: 'results',
        winner: action.payload.winner,
      };

    case 'TICK_TIMER':
      return {
        ...state,
        roundTimer: Math.max(0, state.roundTimer - 1),
      };

    case 'RESET_GAME':
      return initialState;

    default:
      return state;
  }
}

// Context
interface GameContextType {
  state: GameState;
  joinGame: (player: Player) => void;
  startGame: () => void;
  nextRound: () => void;
  eliminatePlayer: (playerId: string) => void;
  endGame: (winner: Player) => void;
  resetGame: () => void;
  stayIn: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

// Provider
export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Timer effect - disabled since we handle timing in the main component
  // useEffect(() => {
  //   if (state.phase === 'playing' && state.roundTimer > 0) {
  //     const timer = setInterval(() => {
  //       dispatch({ type: 'TICK_TIMER' });
  //     }, 1000);
  //     
  //     return () => clearInterval(timer);
  //   } else if (state.phase === 'playing' && state.roundTimer === 0) {
  //     // Round ended, eliminate random players or advance
  //     const alivePlayers = state.players.filter(p => p.status === 'alive');
  //     if (alivePlayers.length > 1) {
  //       // In demo mode, eliminate some random players
  //       if (state.isDemo) {
  //         const toEliminate = Math.floor(alivePlayers.length * 0.3); // Eliminate 30%
  //         for (let i = 0; i < toEliminate; i++) {
  //           const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  //           if (randomPlayer && !randomPlayer.isNPC) continue; // Don't eliminate real player in demo
  //           dispatch({ type: 'ELIMINATE_PLAYER', payload: { playerId: randomPlayer.id } });
  //         }
  //       }
  //       dispatch({ type: 'NEXT_ROUND' });
  //     }
  //   }
  // }, [state.phase, state.roundTimer, state.players]);

  const contextValue: GameContextType = {
    state,
    joinGame: (player) => dispatch({ type: 'JOIN_GAME', payload: { player } }),
    startGame: () => dispatch({ type: 'START_GAME' }),
    nextRound: () => dispatch({ type: 'NEXT_ROUND' }),
    eliminatePlayer: (playerId) => dispatch({ type: 'ELIMINATE_PLAYER', payload: { playerId } }),
    endGame: (winner) => dispatch({ type: 'END_GAME', payload: { winner } }),
    resetGame: () => dispatch({ type: 'RESET_GAME' }),
    stayIn: () => {
      // This function is not used in our current implementation
      // All button logic is handled in the main component
    },
  };

  return (
    <GameContext.Provider value={contextValue}>
      {children}
    </GameContext.Provider>
  );
}

// Hook
export function useGame() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
} 