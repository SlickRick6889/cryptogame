'use client';
import React, { createContext, useContext, useReducer, useEffect } from 'react';

export type GamePhase = 'lobby' | 'playing' | 'results';
export type PlayerStatus = 'alive' | 'eliminated';

export interface Player {
  id: string;
  wallet: string;
  name: string;
  status: PlayerStatus;
  isNPC?: boolean;
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
  | { type: 'SET_DEMO_MODE'; payload: { isDemo: boolean } }
  | { type: 'RESET_GAME' };

// Initial state
const initialState: GameState = {
  phase: 'lobby',
  players: [],
  currentRound: 0,
  maxRounds: 10,
  prizePool: 0,
  entryFee: 0.01,
  roundTimer: 30,
  isDemo: typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_DEMO_MODE === 'true' : false,
};

// Game reducer
function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'JOIN_GAME':
      return {
        ...state,
        players: [...state.players, action.payload.player],
        prizePool: state.prizePool + 1000,
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

    case 'SET_DEMO_MODE':
      return {
        ...state,
        isDemo: action.payload.isDemo,
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

  // Set demo mode after hydration
  useEffect(() => {
    const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
    dispatch({ type: 'SET_DEMO_MODE', payload: { isDemo: isDemoMode } });
  }, []); // Run only once on mount

  const contextValue: GameContextType = {
    state,
    joinGame: (player) => {
      // No NPCs for simple testing
      if (player.isNPC) {
        console.log('🚫 Skipping NPC addition for simple testing:', player.name);
        return;
      }
      dispatch({ type: 'JOIN_GAME', payload: { player } });
    },
    startGame: () => dispatch({ type: 'START_GAME' }),
    nextRound: () => dispatch({ type: 'NEXT_ROUND' }),
    eliminatePlayer: (playerId) => dispatch({ type: 'ELIMINATE_PLAYER', payload: { playerId } }),
    endGame: (winner) => dispatch({ type: 'END_GAME', payload: { winner } }),
    resetGame: () => dispatch({ type: 'RESET_GAME' }),
    stayIn: () => {
      // Simple implementation - handled in main component
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