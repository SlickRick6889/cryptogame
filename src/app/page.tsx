'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { paymentService } from '@/lib/payment';

// Helper function to format token amounts with decimals
function formatTokenAmount(rawAmount: string | number, decimals: number = 9): string {
  const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
  return formatted;
}

export default function Home() {
  const { state, joinGame, startGame, resetGame, endGame } = useGame();
  const wallet = useWallet();
  const { connected, publicKey } = wallet;

  const [gameStarted, setGameStarted] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ x: 50, y: 50 });
  const [buttonVisible, setButtonVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [playerAlive, setPlayerAlive] = useState(true);
  const [tokensDistributed, setTokensDistributed] = useState(false);
  const [actualTokenAmount, setActualTokenAmount] = useState<number | null>(null);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{ success: boolean; swapCompleted: boolean; ballTokensAvailable?: number; swapSignature?: string } | null>(null);
  const [entryFee, setEntryFee] = useState(0.01);
  
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const buttonClickedRef = useRef(false);

  // Load entry fee from Firebase
  useEffect(() => {
    const loadEntryFee = async () => {
      try {
        const fee = await paymentService.getEntryFee();
        setEntryFee(fee);
        console.log('✅ Entry fee loaded:', fee, 'SOL');
      } catch (error) {
        console.error('Error loading entry fee:', error);
      }
    };
    loadEntryFee();
  }, []);

  // Clear game state when wallet disconnects
  useEffect(() => {
    if (!connected) {
      resetGame();
      setGameStarted(false);
      setPlayerAlive(true);
      setTokensDistributed(false);
      setActualTokenAmount(null);
      clearTimers();
    }
  }, [connected, resetGame]);

  // Log game state changes
  useEffect(() => {
    console.log('Game state phase changed:', state.phase, 'Players:', state.players.length);
  }, [state.phase, state.players.length]);

  const clearTimers = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const joinGameAndPlay = async () => {
    if (!connected || !publicKey) {
      alert('Please connect your wallet first!');
      return;
    }

    console.log('Starting game...');

    // Create gameId once and use it throughout the entire function
    const gameId = `game-${Date.now()}`;
    setCurrentGameId(gameId); // Store immediately

    try {
      // Check wallet balance first
      const balanceCheck = await paymentService.checkWalletBalance(publicKey);
      
      if (!balanceCheck.hasEnough) {
        alert(`Insufficient SOL! You have ${balanceCheck.balance.toFixed(3)} SOL, but need at least ${(entryFee + 0.01).toFixed(3)} SOL (${entryFee} entry fee + 0.01 transaction fee)`);
        return;
      }

      // Charge entry fee
      
      const signature = await paymentService.chargeEntryFee(wallet, gameId);

      if (signature) {
        // Record payment in Firebase
        await paymentService.recordGamePayment(publicKey.toString(), gameId, signature);
        
        // Add player to game
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

    // Start the game immediately
    setGameStarted(true);
    startGame();
    setPlayerAlive(true);
    
    // Start the backend game logic and perform Jupiter swap (using same gameId)
    try {
      console.log('🎮 Starting game and performing Jupiter swap...');
      
      const result = await paymentService.startGameAndPrepareTokens(gameId, 1);
      
      if (result.success && result.swapCompleted) {
        console.log('🎮 Game started and Jupiter swap completed successfully!');
        const formattedTokens = formatTokenAmount(result.ballTokensAvailable || 0);
        console.log(`💰 ${formattedTokens} BALL tokens now available for distribution (${result.ballTokensAvailable} raw)`);
        console.log(`📝 Swap transaction: https://solscan.io/tx/${result.swapSignature}`);
        setSwapResult(result); // Store swap result for token distribution
      } else if (result.success && !result.swapCompleted) {
        console.log('⚠️ Game started but Jupiter swap failed - using fallback tokens');
        setSwapResult({ ...result, ballTokensAvailable: 1000000 }); // 1M fallback tokens
      } else {
        console.log('❌ Game start failed completely');
        setSwapResult(null);
      }
    } catch (error) {
      console.error('❌ Error preparing tokens:', error);
      setSwapResult(null);
    }

    // Show the button after a short delay
    setTimeout(() => {
      showButton();
    }, 2000);
  };

  const showButton = () => {
    console.log('Button appearing now!');
    
    buttonClickedRef.current = false;
    
    // Random position
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

    // Hide button after 2 seconds
    hideTimeoutRef.current = setTimeout(() => {
      setButtonVisible(false);
      
      if (!buttonClickedRef.current) {
        console.log('Button missed - player eliminated!');
        setPlayerAlive(false);
      } else {
        console.log('You clicked the button - YOU WIN!');
        handleWin();
      }
    }, 2000);
  };

  const handleButtonClick = () => {
    if (!buttonVisible) return;
    
    buttonClickedRef.current = true;
    clearTimers();
    setButtonVisible(false);
    
    console.log('🏆 Simple testing mode - YOU WIN after one click!');
    handleWin();
  };

  const handleWin = () => {
    const winner = state.players.find(p => p.status === 'alive');
    if (winner) {
      endGame(winner);
    }
  };

  // Distribute tokens when game ends (only if Jupiter swap completed)
  useEffect(() => {
    if (state.phase === 'results' && state.winner && !tokensDistributed && swapResult && currentGameId) {
      const distributeTokens = async () => {
        try {
          console.log('🏆 Distributing tokens to winner:', state.winner?.wallet);
          const formattedDistribution = formatTokenAmount(swapResult.ballTokensAvailable || 0);
          console.log(`💰 Distributing ${formattedDistribution} BALL tokens from Jupiter swap (${swapResult.ballTokensAvailable} raw)`);
          
          const result = await paymentService.distributeTokensToWinner(state.winner!.wallet, currentGameId);
          
          if (result.success) {
            setTokensDistributed(true);
            // Store the formatted amount for display instead of raw amount
            const formattedForDisplay = parseFloat(formatTokenAmount(swapResult.ballTokensAvailable || 1000000).replace(/,/g, ''));
            setActualTokenAmount(formattedForDisplay);
            console.log('✅ Tokens distributed successfully!', result);
          } else {
            console.error('❌ Token distribution failed, but swap was successful');
          }
        } catch (error) {
          console.error('❌ Error distributing tokens:', error);
        }
      };
      
      distributeTokens();
    } else if (state.phase === 'results' && state.winner && !tokensDistributed && !swapResult) {
      console.log('⚠️ Game ended but no Jupiter swap result available - skipping token distribution');
    }
  }, [state.phase, state.winner, tokensDistributed, swapResult, currentGameId]);

  const resetEverything = () => {
    resetGame();
    setGameStarted(false);
    setPlayerAlive(true);
    setTokensDistributed(false);
    setActualTokenAmount(null);
    setCurrentGameId(null);
    setSwapResult(null);
    setButtonVisible(false);
    clearTimers();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent to-black/30" />
      
      {/* Header */}
      <div className="relative z-10 flex justify-between items-center p-6">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            STAYPOOL
          </h1>
          <p className="text-gray-300 text-sm">Crypto Elimination Game</p>
        </div>
        <WalletMultiButton />
      </div>

      {/* Main Game Area */}
      <div className="relative z-10 flex items-center justify-center min-h-[80vh] p-4">
        {/* Lobby Phase */}
        {state.phase === 'lobby' && !gameStarted && (
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white mb-4">Simple Test Mode</h2>
            <p className="text-gray-300 mb-6">
              Click the button when it appears!<br/>
              <span className="text-yellow-400 font-semibold">You have 2 seconds to click it!</span><br/>
              <span className="text-green-400 font-bold">🎯 Click once to win instantly!</span>
            </p>
            <div className="mb-4 text-lg text-yellow-400">
              Entry Fee: {entryFee} SOL
            </div>
            <button
              onClick={joinGameAndPlay}
              disabled={!connected}
              className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 text-white font-bold py-4 px-8 rounded-xl text-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connected ? `Join Game (${entryFee} SOL)` : 'Connect Wallet First'}
            </button>
          </div>
        )}

        {/* Playing Phase */}
        {state.phase === 'playing' && (
          <div className="relative w-full h-full">
            {/* Random Button */}
            {buttonVisible && playerAlive && (
              <button
                onClick={handleButtonClick}
                className="absolute bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-6 px-10 rounded-xl text-2xl transition-all duration-200 transform hover:scale-110 animate-pulse shadow-2xl"
                style={{
                  left: `${buttonPosition.x}%`,
                  top: `${buttonPosition.y}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 50,
                  boxShadow: '0 0 30px rgba(16, 185, 129, 0.6)',
                }}
              >
                CLICK TO WIN! ({timeLeft.toFixed(1)}s)
              </button>
            )}

            {/* Elimination Message */}
            {!playerAlive && (
              <div className="absolute inset-0 flex items-center justify-center z-40">
                <div className="bg-red-900/90 backdrop-blur-lg rounded-xl p-8 border-2 border-red-500 text-center">
                  <h3 className="text-4xl font-bold text-red-400 mb-4">💀 ELIMINATED!</h3>
                  <p className="text-xl text-gray-300 mb-2">You missed the button!</p>
                  <p className="text-lg text-gray-400">Better luck next time...</p>
                </div>
              </div>
            )}

            {/* Instructions */}
            {!buttonVisible && playerAlive && (
              <div className="text-center">
                <h2 className="text-3xl font-bold text-white mb-4">⚠️ GET READY ⚠️</h2>
                <p className="text-xl text-gray-300">
                  Button will appear in a few seconds!<br/>
                  <span className="text-yellow-400 font-bold">Stay alert!</span><br/>
                  <span className="text-red-400 font-bold">Miss = Game Over!</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Results Phase */}
        {state.phase === 'results' && (
          <div className="text-center">
            <h2 className="text-4xl font-bold text-yellow-400 mb-4">🏆 YOU WON!</h2>
            {state.winner && (
              <div className="bg-yellow-900/30 border-2 border-yellow-500 rounded-xl p-8 mb-6 backdrop-blur-lg">
                <div className="text-5xl mb-4">🎉</div>
                <div className="text-3xl font-bold text-yellow-400 mb-2">Congratulations!</div>
                <div className="text-xl text-gray-300 mb-4">YOU WIN THE PRIZE POOL!</div>
                <div className="text-4xl font-black text-green-400 animate-pulse">
                  💰 {actualTokenAmount 
                    ? `${actualTokenAmount.toLocaleString()} BALL` 
                    : 'BALL Tokens'
                  }
                </div>
                <div className="text-sm text-gray-400 mt-2">
                  {tokensDistributed ? '✅ Tokens sent to wallet!' : '⏳ Sending tokens...'}
                </div>
              </div>
            )}
            
            <button
              onClick={resetEverything}
              className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-bold py-4 px-8 rounded-xl text-xl transition-all duration-200 transform hover:scale-105 shadow-lg"
            >
              🔄 Play Again
            </button>
            
            <div className="text-gray-400 text-sm mt-4">
              Ready for another round? Entry fee: {entryFee} SOL
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 