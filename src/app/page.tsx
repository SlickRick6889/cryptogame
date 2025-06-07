'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton, WalletDisconnectButton } from '@solana/wallet-adapter-react-ui';
import { paymentService } from '@/lib/payment';

export default function Home() {
  const { state, joinGame, startGame, resetGame, eliminatePlayer } = useGame();
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  
  console.log('Game state:', state);
  const [demoStarted, setDemoStarted] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ x: 50, y: 50 });
  const [buttonVisible, setButtonVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [playerAlive, setPlayerAlive] = useState(true);
  const [gameTime, setGameTime] = useState(0);
  const [lastCycle, setLastCycle] = useState(0);
  const [tokensDistributed, setTokensDistributed] = useState(false);
  
  // Refs to store timer IDs so we can clear them
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scheduleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const buttonClickedRef = useRef(false);
  const npcEliminationRef = useRef<{ [key: string]: boolean }>({});

  // Demo NPCs
  const demoNPCs = [
    { id: '1', name: 'CryptoNinja🥷', wallet: 'demo1', status: 'alive' as const, isNPC: true },
    { id: '2', name: 'DeFiMaster💰', wallet: 'demo2', status: 'alive' as const, isNPC: true },
    { id: '3', name: 'SolanaKing👑', wallet: 'demo3', status: 'alive' as const, isNPC: true },
    { id: '4', name: 'TokenHunter🎯', wallet: 'demo4', status: 'alive' as const, isNPC: true },
  ];

  const startDemo = async () => {
    console.log('Starting game...');
    
    if (state.isDemo) {
      // Demo mode - add demo player
      joinGame({
        id: 'player',
        wallet: 'demo-player',
        name: 'You (Demo)',
        status: 'alive',
        isNPC: false,
      });
    } else if (connected && publicKey) {
      try {
        // Check wallet balance first
        const balanceCheck = await paymentService.checkWalletBalance(publicKey);
        
        if (!balanceCheck.hasEnough) {
          alert(`Insufficient SOL! You have ${balanceCheck.balance.toFixed(3)} SOL, but need at least 0.06 SOL (0.05 entry fee + 0.01 transaction fee)`);
          return;
        }

        // Charge entry fee
        const gameId = `game-${Date.now()}`;
        const signature = await paymentService.chargeEntryFee(wallet, gameId);

        if (signature) {
          // Record payment in Firebase
          await paymentService.recordGamePayment(publicKey.toString(), gameId, signature);
          
          // Add real player after successful payment
          joinGame({
            id: publicKey.toString(),
            wallet: publicKey.toString(),
            name: `Player ${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}`,
            status: 'alive',
            isNPC: false,
          });
          
          console.log('✅ Entry fee paid, player added to game!');
        }
        
      } catch (error) {
        console.error('❌ Error joining game:', error);
        alert('Failed to join game. Please try again.');
        return;
      }
    } else {
      alert('Please connect your wallet first!');
      return;
    }

    // Add NPCs
    demoNPCs.forEach((npc, index) => {
      setTimeout(() => {
        console.log('Adding NPC:', npc.name);
        joinGame(npc);
      }, (index + 1) * 500);
    });

    setDemoStarted(true);
    console.log('Game started successfully');
  };

  const handleStartGame = () => {
    console.log('Starting game with players:', state.players);
    startGame();
    setPlayerAlive(true);
    setGameTime(0);
    setLastCycle(0);
    npcEliminationRef.current = {};
    console.log('Game started, phase should be playing');
  };

  // Clear all timers
  const clearTimers = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (scheduleTimeoutRef.current) {
      clearTimeout(scheduleTimeoutRef.current);
      scheduleTimeoutRef.current = null;
    }
    if (gameTimerRef.current) {
      clearInterval(gameTimerRef.current);
      gameTimerRef.current = null;
    }
  };

  // Game timer - tracks total game time
  useEffect(() => {
    if (state.phase === 'playing') {
      gameTimerRef.current = setInterval(() => {
        setGameTime(prev => prev + 0.1);
      }, 100);
    } else {
      if (gameTimerRef.current) {
        clearInterval(gameTimerRef.current);
        gameTimerRef.current = null;
      }
    }

    return () => {
      if (gameTimerRef.current) {
        clearInterval(gameTimerRef.current);
        gameTimerRef.current = null;
      }
    };
  }, [state.phase]);

  // Main game loop with truly random timing
  useEffect(() => {
    if (state.phase !== 'playing' || !playerAlive) return;

    const showButton = () => {
      console.log('Button appearing now!');
      
      // Reset the clicked flag
      buttonClickedRef.current = false;
      
      // Random position (keep away from edges)
      const x = Math.random() * 70 + 15; // 15-85%
      const y = Math.random() * 60 + 20; // 20-80%
      
      setButtonPosition({ x, y });
      setButtonVisible(true);
      setTimeLeft(2);

      // Countdown timer
      let timeRemaining = 2;
      countdownRef.current = setInterval(() => {
        timeRemaining -= 0.1;
        setTimeLeft(timeRemaining);
        
        if (timeRemaining <= 0) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
        }
      }, 100);

      // Hide button and check if missed after 2 seconds
      hideTimeoutRef.current = setTimeout(() => {
        setButtonVisible(false);
        
        // If button wasn't clicked = ELIMINATED
        if (!buttonClickedRef.current) {
          console.log('Button missed - player eliminated!');
          setPlayerAlive(false);
        } else {
          console.log('Button clicked successfully!');
        }
      }, 2000);
    };

    const scheduleNextButton = () => {
      // More truly random: anywhere from 2-15 seconds
      const minDelay = 2000;
      const maxDelay = 15000;
      const randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;
      
      console.log(`Next button scheduled in ${(randomDelay/1000).toFixed(1)} seconds`);
      
      scheduleTimeoutRef.current = setTimeout(() => {
        if (state.phase === 'playing' && playerAlive) {
          showButton();
          // Schedule the next one recursively
          scheduleNextButton();
        }
      }, randomDelay);
    };

    // Start the cycle
    scheduleNextButton();

    return () => {
      clearTimers();
    };
  }, [state.phase, playerAlive]);

  // NPC Elimination Logic - eliminate NPCs over 60 seconds
  useEffect(() => {
    if (state.phase !== 'playing') return;

    const aliveNPCs = state.players.filter(p => p.isNPC && p.status === 'alive');
    
    // Eliminate NPCs gradually over 60 seconds
    aliveNPCs.forEach((npc, index) => {
      const eliminationTime = 10 + (index * 12) + Math.random() * 8; // 10-58 seconds, spread out
      
      if (!npcEliminationRef.current[npc.id]) {
        npcEliminationRef.current[npc.id] = true;
        
        setTimeout(() => {
          if (state.phase === 'playing' && state.players.find(p => p.id === npc.id)?.status === 'alive') {
            console.log(`${npc.name} was eliminated after ${eliminationTime.toFixed(1)} seconds!`);
            eliminatePlayer(npc.id);
          }
        }, eliminationTime * 1000);
      }
    });
  }, [state.phase, state.players, eliminatePlayer]);

  // Distribute tokens when game ends and winner is determined
  useEffect(() => {
    if (state.phase === 'results' && state.winner && !tokensDistributed && !state.isDemo) {
      const distributeTokens = async () => {
        try {
          console.log('🏆 Distributing tokens to winner:', state.winner?.wallet);
          const gameId = `game-${Date.now()}`;
          const success = await paymentService.distributeTokensToWinner(state.winner!.wallet, gameId);
          
          if (success) {
            setTokensDistributed(true);
            console.log('✅ Tokens distributed successfully!');
          }
        } catch (error) {
          console.error('❌ Error distributing tokens:', error);
        }
      };
      
      distributeTokens();
    }
  }, [state.phase, state.winner, tokensDistributed, state.isDemo]);

  const handleStayIn = () => {
    if (!buttonVisible) return;
    
    // Mark that button was clicked
    buttonClickedRef.current = true;
    
    // Clear the current button timers
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    // Hide button
    setButtonVisible(false);
    
    console.log('You stayed in!');
    
    // Schedule the next button immediately (don't clear the schedule timer)
    // The main game loop will continue automatically
  };

  const alivePlayers = state.players.filter(p => p.status === 'alive');

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Game Arena Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20"></div>
      </div>

      {/* Prize Pool Display */}
      {state.phase !== 'lobby' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-lg rounded-2xl p-6 border-2 border-yellow-400/50 shadow-2xl">
            <div className="text-center">
              <div className="text-sm text-yellow-300 font-semibold uppercase tracking-wide mb-1">Prize Pool</div>
              <div className="text-4xl font-black text-yellow-400 drop-shadow-lg">
                💰 {state.prizePool.toFixed(2)} STAY
              </div>
              <div className="text-xs text-yellow-300/80 mt-1">Winner takes 90%</div>
            </div>
          </div>
        </div>
      )}

      {/* Game Timer */}
      {state.phase === 'playing' && (
        <div className="absolute top-4 left-4 z-20">
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-3 border border-gray-700">
            <div className="text-center">
              <div className="text-sm text-gray-400">Game Time</div>
              <div className="text-xl font-bold text-white">{gameTime.toFixed(1)}s</div>
            </div>
          </div>
        </div>
      )}

      {/* Players Sidebar */}
      {state.phase === 'playing' && (
        <div className="absolute right-4 top-32 z-10 w-64">
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-4 border border-gray-700">
            <h3 className="text-lg font-bold text-white mb-3 flex items-center">
              <span className="mr-2">🎮</span> Players ({alivePlayers.length}/{state.players.length})
            </h3>
            <div className="space-y-2">
              {state.players.map((player) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between p-2 rounded-lg transition-all ${
                    player.status === 'alive' 
                      ? 'bg-green-500/10 border border-green-500/30' 
                      : 'bg-red-500/10 border border-red-500/30 opacity-50'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${
                      player.status === 'alive' ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                    }`} />
                    <span className={`font-medium ${
                      player.status === 'alive' ? 'text-white' : 'text-gray-400 line-through'
                    }`}>
                      {player.name}
                    </span>
                  </div>
                  <span className="text-xs">
                    {player.status === 'alive' ? '🟢' : '💀'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="relative z-10 text-center pt-8">
        <h1 className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-600 mb-4">
          STAYPOOL
        </h1>
        <p className="text-xl text-gray-300 mb-2">Click the button or DIE! 💀</p>
        
        {/* Wallet Connection */}
        <div className="mb-4">
          {!connected ? (
            <WalletMultiButton className="!bg-gradient-to-r !from-purple-500 !to-pink-600 hover:!from-purple-600 hover:!to-pink-700" />
          ) : (
            <div className="flex items-center justify-center gap-4">
              <div className="bg-green-500/20 border border-green-500 rounded-lg px-4 py-2">
                <span className="text-green-400 font-semibold">
                  ✅ Connected: {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
                </span>
              </div>
              <WalletDisconnectButton className="!bg-red-500 hover:!bg-red-600 !text-white !font-semibold !px-4 !py-2 !rounded-lg !text-sm" />
            </div>
          )}
        </div>
        
        {state.isDemo && (
          <div className="inline-block bg-yellow-500/20 border border-yellow-500 rounded-lg px-4 py-2">
            <span className="text-yellow-400 font-semibold">🎮 DEMO MODE</span>
          </div>
        )}
        {!state.isDemo && !connected && (
          <div className="inline-block bg-red-500/20 border border-red-500 rounded-lg px-4 py-2">
            <span className="text-red-400 font-semibold">⚠️ CONNECT WALLET TO PLAY</span>
          </div>
        )}
      </div>

      {/* Game Status Bar */}
      {state.phase === 'playing' && (
        <div className="relative z-10 mx-auto max-w-4xl mt-6 px-4">
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-4 border border-gray-700">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-cyan-400">{alivePlayers.length}</div>
                <div className="text-gray-400 text-sm">Players Alive</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-400">
                  {playerAlive ? '🟢 ALIVE' : '💀 DEAD'}
                </div>
                <div className="text-gray-400 text-sm">Your Status</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Game Phase */}
      {state.phase === 'lobby' && (
        <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            {!demoStarted ? (
              <div>
                <h2 className="text-3xl font-bold text-white mb-4">One Mistake = Game Over</h2>
                <p className="text-gray-300 mb-6">
                  The button appears randomly within each 2-15 second window!<br/>
                  You never know when it will show up!<br/>
                  <span className="text-yellow-400 font-semibold">You have only 2 seconds to click it!</span><br/>
                  <span className="text-red-400 font-bold">Miss it once and you're ELIMINATED!</span><br/>
                  <span className="text-orange-400 font-semibold">🎯 Most NPCs will be eliminated within 1 minute!</span>
                </p>
                <button
                  onClick={startDemo}
                  disabled={!state.isDemo && !connected}
                  className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 text-white font-bold py-4 px-8 rounded-xl text-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                                          {state.isDemo ? 'Start Demo Game' : 'Join Game (0.05 SOL)'}
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Waiting for Players...</h2>
                <div className="mb-4 text-lg text-yellow-400">
                  Entry Fee: {state.entryFee} SOL each
                </div>
                <div className="space-y-2 mb-6">
                  {state.players.map((player, index) => (
                    <div
                      key={player.id}
                      className="bg-gray-700/50 rounded-lg p-3 animate-pulse"
                      style={{ animationDelay: `${index * 0.1}s` }}
                    >
                      <span className="text-white font-semibold">{player.name}</span>
                      {player.isNPC && <span className="text-gray-400 ml-2">(NPC)</span>}
                    </div>
                  ))}
                </div>
                {state.players.length >= 3 && (
                  <button
                    onClick={handleStartGame}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-xl transition-colors"
                  >
                    Start Game ({state.players.length} Players)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {state.phase === 'playing' && (
        <div className="relative z-10 min-h-[60vh]">
          {/* Random Button */}
          {buttonVisible && playerAlive && (
            <button
              onClick={handleStayIn}
              className="absolute bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-6 px-10 rounded-xl text-2xl transition-all duration-200 transform hover:scale-110 animate-pulse shadow-2xl"
              style={{
                left: `${buttonPosition.x}%`,
                top: `${buttonPosition.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 50,
                boxShadow: '0 0 30px rgba(16, 185, 129, 0.6)',
              }}
            >
              STAY IN! ({timeLeft.toFixed(1)}s)
            </button>
          )}

          {/* Elimination Message */}
          {!playerAlive && (
            <div className="absolute inset-0 flex items-center justify-center z-40">
              <div className="bg-red-900/90 backdrop-blur-lg rounded-xl p-8 border-2 border-red-500 text-center">
                <h3 className="text-4xl font-bold text-red-400 mb-4">💀 ELIMINATED!</h3>
                <p className="text-xl text-gray-300 mb-2">You missed the button!</p>
                <p className="text-lg text-gray-400">Better luck next time...</p>
                <p className="text-sm text-gray-500 mt-2">Watching other players...</p>
              </div>
            </div>
          )}

          {/* Instructions */}
          {playerAlive && !buttonVisible && (
            <div className="text-center mt-20">
              <h2 className="text-3xl font-bold text-white mb-4">⚠️ DANGER ZONE ⚠️</h2>
              <p className="text-xl text-gray-300">
                Button will appear randomly in the next few seconds!<br/>
                <span className="text-yellow-400 font-bold">Stay alert!</span><br/>
                <span className="text-red-400 font-bold">Miss = Instant Death!</span>
              </p>
              <div className="mt-6">
                <div className="inline-block bg-red-500/20 border border-red-500/50 rounded-lg px-6 py-3">
                  <span className="text-red-400 text-lg font-semibold animate-pulse">
                    Button can appear ANY SECOND NOW...
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {state.phase === 'results' && (
        <div className="relative z-10 flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-4xl font-bold text-yellow-400 mb-4">🏆 Game Over!</h2>
            {state.winner ? (
              <div className="bg-yellow-900/30 border-2 border-yellow-500 rounded-xl p-8 mb-6 backdrop-blur-lg">
                <div className="text-5xl mb-4">🎉</div>
                <div className="text-3xl font-bold text-yellow-400 mb-2">{state.winner.name}</div>
                <div className="text-xl text-gray-300 mb-4">WINS THE PRIZE POOL!</div>
                <div className="text-4xl font-black text-green-400 animate-pulse">
                  💰 {state.isDemo ? (state.prizePool * 0.9).toFixed(2) + ' STAY' : '100 DUMMY'}
                </div>
                <div className="text-sm text-gray-400 mt-2">
                  {state.isDemo ? '(10% goes to treasury)' : tokensDistributed ? '✅ Tokens sent to wallet!' : '⏳ Sending tokens...'}
                </div>
              </div>
            ) : (
              <div className="text-xl text-gray-300 mb-6">No winner this round!</div>
            )}
            
            <div className="space-y-3">
              <button
                onClick={() => {
                  resetGame();
                  setDemoStarted(false);
                  setPlayerAlive(true);
                  setGameTime(0);
                  setLastCycle(0);
                  setTokensDistributed(false);
                  npcEliminationRef.current = {};
                  clearTimers();
                }}
                className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-bold py-4 px-8 rounded-xl text-xl transition-all duration-200 transform hover:scale-105 shadow-lg"
              >
                🔄 Play Again
              </button>
              
              <div className="text-gray-400 text-sm">
                Ready for another round? Entry fee: {state.entryFee} SOL
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 