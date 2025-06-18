import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface Player {
  address: string;
  name: string;
  status: 'alive' | 'eliminated';
  responseTime?: number;
  clickedAt?: number;
}

interface GameState {
  status: 'waiting' | 'countdown' | 'playing' | 'completed';
  players: { [address: string]: Player };
  round: number;
  roundStartTime?: number;
  winner?: string;
}

export default function SimpleGame() {
  const { publicKey } = useWallet();
  const [gameState, setGameState] = useState<GameState>({
    status: 'waiting',
    players: {},
    round: 0
  });
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [hasClicked, setHasClicked] = useState(false);
  const roundTimerRef = useRef<NodeJS.Timeout>();
  const countdownRef = useRef<NodeJS.Timeout>();

  // Add player to game
  const joinGame = () => {
    if (!publicKey) return;
    
    setGameState(prev => ({
      ...prev,
      players: {
        ...prev.players,
        [publicKey.toBase58()]: {
          address: publicKey.toBase58(),
          name: `Player ${publicKey.toBase58().slice(0, 4)}`,
          status: 'alive'
        }
      }
    }));
  };

  // Start countdown when 2+ players
  useEffect(() => {
    const playerCount = Object.keys(gameState.players).length;
    
    if (playerCount >= 2 && gameState.status === 'waiting') {
      console.log('🚀 Starting countdown with', playerCount, 'players');
      setGameState(prev => ({ ...prev, status: 'countdown' }));
      setTimeRemaining(5); // 5 second countdown
      
      countdownRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            startRound();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [Object.keys(gameState.players).length, gameState.status]);

  // Start a new round
  const startRound = () => {
    console.log('🎮 Starting round', gameState.round + 1);
    
    const roundStartTime = Date.now();
    setGameState(prev => ({
      ...prev,
      status: 'playing',
      round: prev.round + 1,
      roundStartTime
    }));
    
    setHasClicked(false);
    setTimeRemaining(5); // 5 seconds to click
    
    // Round timer
    roundTimerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          processRound();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Player clicks survival button
  const handleClick = () => {
    if (!publicKey || hasClicked || gameState.status !== 'playing') return;
    
    const clickTime = Date.now();
    const responseTime = clickTime - (gameState.roundStartTime || 0);
    
    console.log(`✅ Player clicked! Response time: ${responseTime}ms`);
    
    setHasClicked(true);
    setGameState(prev => ({
      ...prev,
      players: {
        ...prev.players,
        [publicKey.toBase58()]: {
          ...prev.players[publicKey.toBase58()],
          responseTime,
          clickedAt: clickTime
        }
      }
    }));
  };

  // Process round results
  const processRound = () => {
    if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    
    console.log('⏰ Round ended, processing results...');
    
    const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive');
    const playersWhoClicked = alivePlayers.filter(p => p.responseTime !== undefined);
    
    console.log(`📊 ${playersWhoClicked.length}/${alivePlayers.length} players clicked`);
    
    setGameState(prev => {
      const newPlayers = { ...prev.players };
      
      if (playersWhoClicked.length > 1) {
        // Eliminate slowest player
        playersWhoClicked.sort((a, b) => (b.responseTime || 0) - (a.responseTime || 0));
        const slowestPlayer = playersWhoClicked[0];
        
        newPlayers[slowestPlayer.address] = {
          ...slowestPlayer,
          status: 'eliminated'
        };
        
        console.log(`🐌 Eliminated slowest: ${slowestPlayer.address.slice(0, 8)} (${slowestPlayer.responseTime}ms)`);
      } else if (playersWhoClicked.length === 1) {
        // Only 1 clicked - eliminate others
        alivePlayers.forEach(player => {
          if (!player.responseTime) {
            newPlayers[player.address] = {
              ...player,
              status: 'eliminated'
            };
            console.log(`💀 Eliminated non-clicker: ${player.address.slice(0, 8)}`);
          }
        });
      } else {
        // Nobody clicked - random elimination
        const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        newPlayers[randomPlayer.address] = {
          ...randomPlayer,
          status: 'eliminated'
        };
        console.log(`🎲 Random elimination: ${randomPlayer.address.slice(0, 8)}`);
      }
      
      // Check for winner
      const remainingAlive = Object.values(newPlayers).filter(p => p.status === 'alive');
      
      if (remainingAlive.length <= 1) {
        const winner = remainingAlive[0];
        console.log(`🎉 Winner: ${winner?.address || 'None'}`);
        
        return {
          ...prev,
          players: newPlayers,
          status: 'completed',
          winner: winner?.address
        };
      } else {
        // Reset for next round
        Object.keys(newPlayers).forEach(address => {
          if (newPlayers[address].status === 'alive') {
            delete newPlayers[address].responseTime;
            delete newPlayers[address].clickedAt;
          }
        });
        
        setTimeout(() => startRound(), 2000); // 2 second break between rounds
        
        return {
          ...prev,
          players: newPlayers,
          status: 'countdown'
        };
      }
    });
  };

  const alivePlayers = Object.values(gameState.players).filter(p => p.status === 'alive');
  const isWinner = gameState.winner === publicKey?.toBase58();

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">🎮 SIMPLE ELIMINATION GAME</h1>
        
        {/* Game Status */}
        <div className="text-center mb-6">
          {gameState.status === 'waiting' && (
            <div>
              <p className="text-xl mb-4">⏳ Waiting for players...</p>
              <p className="text-gray-400">Players: {Object.keys(gameState.players).length}/5</p>
              {!publicKey ? (
                <p className="text-red-400">Connect wallet to join</p>
              ) : !gameState.players[publicKey.toBase58()] ? (
                <button 
                  onClick={joinGame}
                  className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold"
                >
                  🎯 JOIN GAME
                </button>
              ) : (
                <p className="text-green-400">✅ You're in! Waiting for more players...</p>
              )}
            </div>
          )}
          
          {gameState.status === 'countdown' && (
            <div>
              <p className="text-2xl text-yellow-400">🚀 Game starting in {timeRemaining}s</p>
              <p className="text-gray-400">Get ready to click fast!</p>
            </div>
          )}
          
          {gameState.status === 'playing' && (
            <div>
              <p className="text-xl">⚡ ROUND {gameState.round}</p>
              <p className="text-3xl text-red-400 my-4">{timeRemaining}</p>
              <p className="text-gray-400">Alive: {alivePlayers.length}</p>
              
              <button
                onClick={handleClick}
                disabled={hasClicked || !publicKey || gameState.players[publicKey.toBase58()]?.status !== 'alive'}
                className={`px-8 py-4 rounded-lg font-bold text-xl mt-4 ${
                  hasClicked 
                    ? 'bg-green-600 text-white' 
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {hasClicked ? '✅ CLICKED!' : '🖱️ CLICK TO SURVIVE!'}
              </button>
              
                             {hasClicked && publicKey && gameState.players[publicKey.toBase58()]?.responseTime && (
                 <p className="text-green-400 mt-2">
                   Your time: {gameState.players[publicKey.toBase58()].responseTime}ms
                 </p>
               )}
            </div>
          )}
          
          {gameState.status === 'completed' && (
            <div>
              {isWinner ? (
                <div>
                  <p className="text-4xl text-green-400 mb-4">🎉 YOU WON! 🎉</p>
                  <p className="text-xl">Congratulations!</p>
                </div>
              ) : (
                <div>
                  <p className="text-2xl text-red-400 mb-4">💀 Game Over</p>
                  <p className="text-xl">Winner: {gameState.winner?.slice(0, 8)}...</p>
                </div>
              )}
              
              <button 
                onClick={() => window.location.reload()}
                className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold mt-4"
              >
                🔄 Play Again
              </button>
            </div>
          )}
        </div>
        
        {/* Players List */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-bold mb-3">👥 Players:</h3>
          {Object.values(gameState.players).map(player => (
            <div 
              key={player.address}
              className={`flex justify-between items-center py-2 px-3 rounded ${
                player.status === 'alive' ? 'bg-green-900' : 'bg-red-900'
              }`}
            >
              <span>{player.name}</span>
              <div className="text-sm">
                <span className={player.status === 'alive' ? 'text-green-400' : 'text-red-400'}>
                  {player.status === 'alive' ? '✅ Alive' : '💀 Eliminated'}
                </span>
                {player.responseTime && (
                  <span className="ml-2 text-gray-400">
                    ({player.responseTime}ms)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {/* Debug Info */}
        <div className="mt-4 text-xs text-gray-500">
          <p>Status: {gameState.status} | Round: {gameState.round}</p>
          <p>Frontend timing - no backend needed!</p>
        </div>
      </div>
    </div>
  );
} 