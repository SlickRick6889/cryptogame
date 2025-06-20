'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { doc as firestoreDoc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useGame } from '../context/GameContext';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface GameConfig {
  entryFeeSol: number;
  prizeTokenMintAddress: string;
  tokenSymbol: string;
  treasuryWallet: string;
  network: string;
  maxPlayersPerGame: number;
}

interface Player {
  address: string;
  name: string;
  status: 'alive' | 'eliminated';
  isNpc: boolean;
  lastActionRound: number;
  joinedAt: Timestamp;
  solPaid: number;
  transactionSignature?: string;
  responseTime?: number | null;
  refundRequested: boolean;
  displayName?: string;
}

interface GameData {
  status: 'waiting' | 'lobby' | 'starting' | 'in_progress' | 'completed' | 'cancelled' | 'ended';
  players: { [address: string]: Player };
  playerCount: number;
  round: number;
  roundStartedAt?: Timestamp;
  roundDurationSec: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  totalSolCollected: number;
  entryFeeSol: number;
  ballTokenMint: string;
  tokenSymbol: string;
  maxPlayers: number;
  payments: PaymentRecord[];
  countdownStartedAt?: Timestamp | null;
  countdownDuration: number;
  winner?: string | null;
  completedAt?: Timestamp;
  statusMessage?: string;
  prize?: PrizeInfo;
}

interface PaymentRecord {
  player: string;
  signature: string;
  amount: number;
}

interface PrizeInfo {
  prizeAmountFormatted?: string;
  tokenSymbol?: string;
  rawAmount?: number;
  solCollected?: number;
  transferSignature?: string;
  transferSuccess?: boolean;
  processing?: boolean;
  status?: string;
  error?: string;
  preSwapped?: boolean;
  swapSignature?: string;
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

interface PlayerActionRequest {
  gameId: string;
  playerAddress: string;
  clientTimestamp: number;
  clientResponseTime: number;
  buttonAppearanceTime: number;
  roundStartTime: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Home() {
  const { publicKey, sendTransaction, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  
  // CLEANED: Only import the functions we actually need
  const { 
    joinLobby, 
    requestRefund, 
    playerAction, 
    gameData, 
    gameId, 
    setGameId, 
    setGameData,
    triggerGameProcessing
  } = useGame();

  // State management
  const [loadingJoin, setLoadingJoin] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionClicked, setActionClicked] = useState<boolean>(false);
  const [prizeEstimate, setPrizeEstimate] = useState<string>('Loading...');
  const [lobbyRemaining, setLobbyRemaining] = useState<number>(0);
  const [roundRemaining, setRoundRemaining] = useState<number>(0);

  // Refs for proper cleanup and consistent round detection
  const lastRoundRef = useRef<number | null>(null);
  const buttonAppearanceTimeRef = useRef<number | null>(null);
  const lobbyIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const roundIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // SECURE: Config without exposed API keys
  const [config, setConfig] = useState<GameConfig | null>(null);

  // OPTIMIZED: Memoized prize estimation
  const updatePrizeEstimate = useCallback(async (solAmount: number) => {
    if (!config || solAmount <= 0) {
      setPrizeEstimate('Loading...');
      return;
    }
    
    try {
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
      const quoteParams = new URLSearchParams({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: config.prizeTokenMintAddress,
        amount: lamports.toString(),
        slippageBps: '300' // 3% slippage
      });
      
      const response = await fetch(`https://quote-api.jup.ag/v6/quote?${quoteParams}`);
      const data = await response.json();
      
      if (data?.outAmount) {
        // USDC has 6 decimals
        const tokenAmount = parseInt(data.outAmount) / Math.pow(10, 6);
        setPrizeEstimate(`~${tokenAmount.toLocaleString('en-US', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        })}`);
      } else {
        setPrizeEstimate('Quote unavailable');
      }
    } catch (error) {
      console.error('Prize estimate error:', error);
      setPrizeEstimate('Quote unavailable');
    }
  }, [config]);

  // Update prize estimate when game data changes
  useEffect(() => {
    if (gameData && config) {
      const totalSol = config.entryFeeSol * gameData.playerCount;
      updatePrizeEstimate(totalSol);
    }
  }, [gameData?.playerCount, config?.entryFeeSol, updatePrizeEstimate]);

  // SECURE: Load config without exposing API keys
  useEffect(() => {
    let mounted = true;
    
    (async () => {
      try {
        const snap = await getDoc(firestoreDoc(db, 'config', 'game'));
        
        if (!mounted) return; // Prevent state updates if unmounted
        
        const defaultConfig: GameConfig = {
          entryFeeSol: 0.01,
          prizeTokenMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenSymbol: 'USDC',
          treasuryWallet: 'E6xLj38Y2nuhKx2f8wCLJnYAuMZq86m1A7ArD7be8r7h',
          network: 'mainnet',
          maxPlayersPerGame: 5
        };
        
        if (snap.exists()) {
          const data = snap.data();
          setConfig({ 
            entryFeeSol: data.entryFee || defaultConfig.entryFeeSol,
            prizeTokenMintAddress: data.prizeTokenMintAddress || defaultConfig.prizeTokenMintAddress,
            tokenSymbol: data.tokenSymbol || defaultConfig.tokenSymbol,
            treasuryWallet: data.treasuryWallet || defaultConfig.treasuryWallet,
            network: data.network || defaultConfig.network,
            maxPlayersPerGame: data.maxPlayersPerGame || defaultConfig.maxPlayersPerGame
            // REMOVED: rpcUrl (use wallet adapter's connection instead)
          });
        } else {
          setConfig(defaultConfig);
        }
      } catch (err: any) {
        console.error('Failed to load config:', err);
        if (mounted) {
          setErrorMessage(`Failed to load game configuration: ${err.message}`);
          setConfig({
            entryFeeSol: 0.01,
            prizeTokenMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            tokenSymbol: 'USDC',
            treasuryWallet: 'E6xLj38Y2nuhKx2f8wCLJnYAuMZq86m1A7ArD7be8r7h',
            network: 'mainnet',
            maxPlayersPerGame: 5
          });
        }
      }
    })();
    
    return () => { mounted = false; };
  }, []);

  // FIXED: Lobby countdown with proper cleanup
  useEffect(() => {
    // Clear any existing interval
    if (lobbyIntervalRef.current) {
      clearInterval(lobbyIntervalRef.current);
      lobbyIntervalRef.current = null;
    }
    
    if (!gameData || gameData.status !== 'lobby' || !gameData.countdownStartedAt) {
      setLobbyRemaining(0);
      return;
    }

    const duration = gameData.countdownDuration || 15;
    const startMs = gameData.countdownStartedAt.toMillis();
    
    lobbyIntervalRef.current = setInterval(() => {
      const secs = Math.max(0, duration - (Date.now() - startMs) / 1000);
      setLobbyRemaining(Math.ceil(secs));
      
      if (secs <= 0) {
        if (lobbyIntervalRef.current) {
          clearInterval(lobbyIntervalRef.current);
          lobbyIntervalRef.current = null;
        }
        // Trigger immediate game processing via callable function
        console.log('⏰ Lobby countdown expired - triggering game start');
        if (gameId) {
          triggerGameProcessing(gameId).catch((err: any) => 
            console.error('Failed to trigger game start:', err)
          );
        }
      }
    }, 200);

    return () => {
      if (lobbyIntervalRef.current) {
        clearInterval(lobbyIntervalRef.current);
        lobbyIntervalRef.current = null;
      }
    };
  }, [gameData?.status, gameData?.countdownStartedAt?.toMillis()]);

  // FIXED: Round countdown with proper cleanup and consistent round detection
  useEffect(() => {
    // Clear any existing interval
    if (roundIntervalRef.current) {
      clearInterval(roundIntervalRef.current);
      roundIntervalRef.current = null;
    }
    
    if (!gameData || gameData.status !== 'in_progress' || !gameData.roundStartedAt) {
      setRoundRemaining(0);
      return;
    }

    const duration = gameData.roundDurationSec || 5;
    const startMs = gameData.roundStartedAt.toMillis();
    
    // FIXED: Use round number for consistent detection
    if (lastRoundRef.current !== gameData.round) {
      console.log(`🔄 New round detected: ${gameData.round} (was: ${lastRoundRef.current})`);
      
      // Reset action state for new round
      setActionClicked(false);
      setSuccessMessage(null);
      setErrorMessage(null);
      lastRoundRef.current = gameData.round;
      
      // Record button appearance time locally
      buttonAppearanceTimeRef.current = Date.now();
      console.log(`⏰ Button appeared at: ${buttonAppearanceTimeRef.current}`);
    }
    
    roundIntervalRef.current = setInterval(() => {
      const secs = Math.max(0, duration - (Date.now() - startMs) / 1000);
      setRoundRemaining(Math.ceil(secs));
      
      if (secs <= 0) {
        if (roundIntervalRef.current) {
          clearInterval(roundIntervalRef.current);
          roundIntervalRef.current = null;
        }
        // Trigger immediate round processing via callable function
        console.log('⏰ Round expired - triggering next round');
        if (gameId) {
          triggerGameProcessing(gameId).catch((err: any) => 
            console.error('Failed to trigger round processing:', err)
          );
        }
      }
    }, 200);

    return () => {
      if (roundIntervalRef.current) {
        clearInterval(roundIntervalRef.current);
        roundIntervalRef.current = null;
      }
    };
  }, [gameData?.round, gameData?.roundStartedAt?.toMillis(), gameData?.status]);

  // CLEANUP: Clear intervals on unmount
  useEffect(() => {
    return () => {
      if (lobbyIntervalRef.current) clearInterval(lobbyIntervalRef.current);
      if (roundIntervalRef.current) clearInterval(roundIntervalRef.current);
    };
  }, []);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  // SIMPLIFIED: Single join handler
  const handleJoin = useCallback(async () => {
    if (!publicKey || !connection || !config) {
      setErrorMessage('Wallet not connected or config not loaded.');
      return;
    }
    
    setLoadingJoin(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    const address = publicKey.toBase58();
    console.log(`🎮 Joining game with wallet: ${address}`);
    
    try {
      // Step 1: Try to join without payment first
      const res: JoinLobbyResponse = await joinLobby(address);
      
      if (!res.success && res.requiresPayment && res.treasuryAddress) {
        // Step 2: Payment required
        console.log(`💰 Payment required: ${res.entryFee} SOL`);
        
        const lamports = Math.floor(config.entryFeeSol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({ 
            fromPubkey: publicKey, 
            toPubkey: new PublicKey(res.treasuryAddress), 
            lamports 
          })
        );
        
        // Use wallet adapter's connection
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        // Optional transaction simulation
        try {
          const simulationResult = await connection.simulateTransaction(tx);
          if (simulationResult.value.err) {
            setErrorMessage(`Transaction simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
            setLoadingJoin(false);
            return;
          }
        } catch (simErr: any) {
          console.warn('Transaction simulation experienced an error (non-fatal):', simErr);
        }

        console.log("📤 Sending payment transaction...");
        const sig = await sendTransaction(tx, connection);
        setSuccessMessage(`Transaction sent: ${sig.slice(0, 8)}...`);
        
        // Wait for confirmation
        await connection.confirmTransaction(sig, 'confirmed');
        setSuccessMessage('Payment confirmed. Joining game...');
        
        // Step 3: Join with payment signature
        const joinResult: JoinLobbyResponse = await joinLobby(address, sig);
        
        if (joinResult.success) {
          setSuccessMessage(`🎮 Joined game ${joinResult.gameId}! Players: ${joinResult.playerCount}/${joinResult.maxPlayers}`);
        } else {
          setErrorMessage(`Failed after payment: ${joinResult.message}`);
        }
      } else if (res.success) {
        setSuccessMessage(`🎮 Joined game ${res.gameId}! Players: ${res.playerCount}/${res.maxPlayers}`);
      } else {
        setErrorMessage(`Failed to join: ${res.message}`);
      }
    } catch (err: any) {
      console.error('Join error:', err);
      setErrorMessage(`Error: ${err.message || err}`);
    } finally {
      setLoadingJoin(false);
    }
  }, [publicKey, connection, config, joinLobby, sendTransaction]);

  // SIMPLIFIED: Single action handler (no dual paths)
  const handleAction = useCallback(async () => {
    if (!publicKey || !gameData || !gameId || roundRemaining <= 0 || actionClicked) return;
    
    const playerStatus = gameData.players[publicKey.toBase58()]?.status;
    if (playerStatus !== 'alive') return;
    
    const clickTime = Date.now();
    const buttonAppearTime = buttonAppearanceTimeRef.current;
    
    if (!buttonAppearTime) {
      setErrorMessage('Timing error - please try again');
      return;
    }
    
    // Calculate accurate local response time
    const localResponseTime = clickTime - buttonAppearTime;
    
    // Immediately show clicked state
    setActionClicked(true);
    setSuccessMessage(`⚡ Clicked in ${localResponseTime}ms!`);
    setErrorMessage(null);
    
    try {
      const actionRequest: PlayerActionRequest = {
        gameId, 
        playerAddress: publicKey.toBase58(), 
        clientTimestamp: clickTime,
        clientResponseTime: localResponseTime,
        buttonAppearanceTime: buttonAppearTime,
        roundStartTime: gameData.roundStartedAt?.toMillis() || 0
      };
      
      await playerAction(actionRequest);
      
      console.log(`✅ Action successful! Response time: ${localResponseTime}ms`);
    } catch (err: any) {
      console.error('Action error:', err);
      setErrorMessage(`❌ Error: ${err.message}`);
      setActionClicked(false); // Reset on error
    }
  }, [publicKey, gameData, gameId, roundRemaining, actionClicked, playerAction]);

  // Refund handler
  const handleRefund = useCallback(async () => {
    if (!publicKey || !gameId) return;
    
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      await requestRefund(gameId, publicKey.toBase58());
      setSuccessMessage('Refund request sent!');
    } catch (err: any) {
      setErrorMessage(`Refund error: ${err.message}`);
    }
  }, [publicKey, gameId, requestRefund]);

  // Play again handler
  const handlePlayAgain = useCallback(() => {
    console.log('🔄 Play Again - resetting state');
    
    // Clear intervals
    if (lobbyIntervalRef.current) clearInterval(lobbyIntervalRef.current);
    if (roundIntervalRef.current) clearInterval(roundIntervalRef.current);
    
    // Reset state
    setGameId(null);
    setGameData(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setActionClicked(false);
    setLoadingJoin(false);
    setRoundRemaining(0);
    setLobbyRemaining(0);
    setPrizeEstimate('0');
    
    // Reset refs
    lastRoundRef.current = null;
    buttonAppearanceTimeRef.current = null;
    lobbyIntervalRef.current = null;
    roundIntervalRef.current = null;
  }, [setGameId, setGameData]);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  // Get player rankings (memoized for performance)
  const getPlayerRankings = useCallback(() => {
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
  }, [gameData?.players]);

  // ============================================================================
  // RENDER LOGIC
  // ============================================================================

  let contentToRender: React.ReactNode = null;

  if (!connected) {
    contentToRender = (
      <div id="wallet-section">
        <div style={{ marginBottom: '20px', color: '#00ffff' }}>
          <p>🚀 Connect your Solana wallet to start playing!</p>
          <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '10px' }}>
            Supports all major wallets with mobile deep linking!
          </p>
        </div>
        <WalletMultiButton className="wallet-btn" />
        <div className="text-sm mt-2">
          {connected ? `Connected: ${publicKey?.toBase58().slice(0, 8)}...` : 'Not Connected'}
        </div>
      </div>
    );
  } else if (!gameId) {
    contentToRender = (
      <div id="lobby-section">
        <p className="status">🎮 Multiplayer Battle Royale</p>
        <div style={{ margin: '15px 0', color: '#ffff00' }}>
          <p>💰 Entry Fee: {config ? `${config.entryFeeSol} SOL` : 'Loading...'}</p>
          <p>🏆 Prize: Winner takes all SOL (swapped to {config?.tokenSymbol || 'USDC'} tokens)</p>
          <small style={{ color: '#aaa' }}>Real players only - slowest eliminated each round!</small>
          {config && (
            <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '10px' }}>
              <p>Network: {config.network} | Max Players: {config.maxPlayersPerGame}</p>
              <p>Treasury: {config.treasuryWallet.slice(0, 8)}...</p>
            </div>
          )}
        </div>
        <button className="action-btn" onClick={handleJoin} disabled={loadingJoin}>
          {loadingJoin ? 'Joining...' : '🎯 JOIN MULTIPLAYER GAME'}
        </button>
        <button onClick={disconnect} className="action-btn" style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
          Disconnect
        </button>
      </div>
    );
  } else if (!gameData) {
    contentToRender = <p className="text-center text-white">Loading game data...</p>;
  } else {
    // Game state rendering
    switch (gameData.status) {
      case 'waiting':
        contentToRender = (
          <div id="waiting-section">
            <p className="status">⏳ Waiting for Players...</p>
            <div style={{ margin: '20px 0', color: '#00ffff' }}>
              <p className="text-lg mb-2">Game ID: {gameId}</p>
              <p className="text-base mb-4">Players: {gameData.playerCount}/{gameData.maxPlayers}</p>
              <p className="text-lg text-green-400 font-bold my-2">
                💰 Current Pot: {config ? (config.entryFeeSol * gameData.playerCount).toFixed(2) : 'Loading...'} SOL
              </p>
              <p className="text-lg text-yellow-400 font-bold my-2">
                🏆 Prize Estimate: {prizeEstimate} {config?.tokenSymbol || 'USDC'}
              </p>
              <p className="text-3xl text-red-500 my-4">
                {lobbyRemaining > 0 ? `Starts in: ${lobbyRemaining}s` : 'Starting Soon!'}
              </p>
              <p className="text-gray-400 text-sm">{gameData.statusMessage || ''}</p>
            </div>
            <button className="action-btn" onClick={handleRefund} style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
              💰 LEAVE & GET REFUND ({config ? (config.entryFeeSol - 0.0005).toFixed(4) : '0.0095'} SOL)
            </button>
            <p style={{ marginTop: '10px', color: '#aaa', fontSize: '0.8rem' }}>
              Refund: Entry fee minus 0.0005 SOL transfer fee. Timer resets when players join/leave.
            </p>
          </div>
        );
        break;

      case 'lobby':
        contentToRender = (
          <div id="lobby-section-countdown">
            <p className="status">🎮 Multiplayer Battle Royale</p>
            <div style={{ margin: '15px 0', color: '#ffff00' }}>
              <p>💰 Entry Fee: {config ? `${config.entryFeeSol} SOL` : 'Loading...'}</p>
              <p>🏆 Prize: Winner takes all SOL (swapped to {config?.tokenSymbol || 'USDC'} tokens)</p>
              <small style={{ color: '#aaa' }}>Real players only - slowest eliminated each round!</small>
              {config && (
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '10px' }}>
                  <p>Network: {config.network} | Max Players: {config.maxPlayersPerGame}</p>
                  <p>Treasury: {config.treasuryWallet.slice(0, 8)}...</p>
                </div>
              )}
            </div>
            <p className="status">⏳ Game Starts in: {lobbyRemaining}s</p>
            <p className="text-white">Players: {gameData.playerCount}/{gameData.maxPlayers}</p>
            {config && <p className="text-white">Pot: {(config.entryFeeSol * gameData.playerCount).toFixed(2)} SOL</p>}
            <p className="text-yellow-400 font-bold">🏆 Prize: {prizeEstimate} {config?.tokenSymbol || 'USDC'}</p>
            <button className="action-btn" onClick={handleRefund} style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
              💰 LEAVE & GET REFUND ({config ? (config.entryFeeSol - 0.0005).toFixed(4) : '0.0095'} SOL)
            </button>
          </div>
        );
        break;

      case 'starting':
        contentToRender = (
          <div className="text-center mt-20">
            <p className="status">🚀 Game is starting…</p>
            <p className="text-red-400 mt-4">⚠️ No refunds allowed once game starts!</p>
            <p className="text-white mt-2">Get ready to click fast - slowest response time gets eliminated!</p>
          </div>
        );
        break;

      case 'in_progress':
        const playerRankings = getPlayerRankings();
        contentToRender = (
          <div id="game-section">
            <p className="status">ELIMINATION ROUND {gameData.round}</p>
            <p className="timer">{roundRemaining}</p>
            <p className="players">Alive: {Object.values(gameData.players).filter(p => p.status === 'alive').length}</p>
            <button 
              onClick={handleAction} 
              disabled={!publicKey || gameData.players[publicKey.toBase58()]?.status !== 'alive' || roundRemaining <= 0 || actionClicked} 
              className={`action-btn ${actionClicked ? 'clicked' : ''}`}
              style={actionClicked ? { 
                background: 'linear-gradient(45deg, #00ff00, #00cc00)', 
                transform: 'scale(0.95)',
                boxShadow: '0 0 20px rgba(0, 255, 0, 0.5)'
              } : {}}
            >
              {actionClicked ? '✅ CLICKED!' : 
               publicKey && gameData.players[publicKey.toBase58()]?.status === 'alive' ? 'Click to Survive!' : 'Eliminated'}
            </button>
            {successMessage && (
              <p className="text-green-400 text-sm mt-2 font-bold">{successMessage}</p>
            )}
            {errorMessage && (
              <p className="text-red-400 text-sm mt-2">{errorMessage}</p>
            )}
            
            {/* Player Rankings */}
            <div className="mt-6 bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold text-blue-300 mb-3">🏆 Player Rankings</h3>
              <div className="space-y-2">
                {playerRankings.map((player, index) => (
                  <div 
                    key={player.address}
                    className={`flex justify-between items-center p-2 rounded ${
                      player.status === 'alive' ? 'bg-green-900/30' : 'bg-red-900/30'
                    } ${player.address === publicKey?.toBase58() ? 'ring-2 ring-blue-400' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">#{index + 1}</span>
                      <span className={player.status === 'alive' ? 'text-green-300' : 'text-red-400'}>
                        {player.status === 'alive' ? '✅' : '💀'}
                      </span>
                      <span className="text-white">
                        {player.displayName}
                        {player.address === publicKey?.toBase58() && <span className="text-blue-300 ml-1">(You)</span>}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm ${player.status === 'alive' ? 'text-green-300' : 'text-red-400'}`}>
                        {player.status === 'alive' ? 'Alive' : 'Eliminated'}
                      </span>
                      {player.responseTime && (
                        <div className="text-xs text-gray-400">
                          {player.responseTime}ms
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
        break;

      case 'completed':
        const completedPlayerRankings = getPlayerRankings();
        contentToRender = (
          <div id="winner-section">
            {gameData.winner === publicKey?.toBase58() ? (
              <div className="winner-screen">
                <p className="text-green-400 text-2xl font-bold mb-4">🎉 YOU ARE THE LAST STANDING DEGEN! 🎉</p>
                <div>
                  <p className="text-white text-xl">Prize: {gameData.prize?.prizeAmountFormatted || 'Processing...'}</p>
                  {gameData.prize?.status && (
                    <p className={`text-sm mt-2 ${gameData.prize?.error ? 'text-red-400' : 'text-green-400'}`}>
                      {gameData.prize.status}
                    </p>
                  )}
                  
                  {/* Debug info */}
                  <div className="mt-4 p-3 bg-gray-800 rounded text-xs">
                    <p className="text-yellow-400 font-bold">🔍 Prize Debug Info:</p>
                    <p>Raw Amount: {gameData.prize?.rawAmount}</p>
                    <p>SOL Collected: {gameData.prize?.solCollected}</p>
                    <p>Token Symbol: {gameData.prize?.tokenSymbol}</p>
                    <p>Transfer Signature: {gameData.prize?.transferSignature || 'None'}</p>
                    <p>Processing: {gameData.prize?.processing ? 'Yes' : 'No'}</p>
                    <p>Error: {gameData.prize?.error || 'None'}</p>
                  </div>
                  {gameData.prize?.transferSignature && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-400">
                        Transaction: {gameData.prize.transferSignature.slice(0, 8)}...
                      </p>
                      <a 
                        href={`https://solscan.io/tx/${gameData.prize.transferSignature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-sm underline"
                      >
                        🔗 View on Solscan
                      </a>
                    </div>
                  )}
                  <div className="mt-3 text-xs text-gray-300">
                    <p>🏆 Prize sent to: {publicKey?.toBase58().slice(0, 8)}...{publicKey?.toBase58().slice(-8)}</p>
                    <p>💰 Amount: {gameData.prize?.prizeAmountFormatted}</p>
                    <p>📝 Check your wallet balance!</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="game-card">
                <p className="status">Game Over!</p>
                <p className="text-red-400 text-2xl mb-4">You were eliminated.</p>
                <p className="text-white text-xl">Winner: {gameData.winner?.slice(0, 8)}...</p>
                {gameData.prize && (
                  <p className="text-white text-md">Prize: {gameData.prize?.prizeAmountFormatted}</p>
                )}
              </div>
            )}
            
            {/* Final Game Rankings */}
            <div className="mt-6 bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold text-yellow-300 mb-3">🏆 Final Rankings</h3>
              <div className="space-y-2">
                {completedPlayerRankings.map((player, index) => (
                  <div 
                    key={player.address}
                    className={`flex justify-between items-center p-2 rounded ${
                      index === 0 ? 'bg-yellow-900/30 ring-1 ring-yellow-400' : 
                      player.status === 'alive' ? 'bg-green-900/30' : 'bg-red-900/30'
                    } ${player.address === publicKey?.toBase58() ? 'ring-2 ring-blue-400' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${index === 0 ? 'text-yellow-300' : 'text-white'}`}>
                        {index === 0 ? '👑' : `#${index + 1}`}
                      </span>
                      <span className={player.status === 'alive' ? 'text-green-300' : 'text-red-400'}>
                        {player.status === 'alive' ? '🏆' : '💀'}
                      </span>
                      <span className="text-white">
                        {player.displayName}
                        {player.address === publicKey?.toBase58() && <span className="text-blue-300 ml-1">(You)</span>}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm ${index === 0 ? 'text-yellow-300' : player.status === 'alive' ? 'text-green-300' : 'text-red-400'}`}>
                        {index === 0 ? 'WINNER!' : player.status === 'alive' ? 'Survived' : 'Eliminated'}
                      </span>
                      {player.responseTime && (
                        <div className="text-xs text-gray-400">
                          {player.responseTime}ms
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="flex gap-4 mt-6">
              <button onClick={handlePlayAgain} className="action-btn flex-1">
                🎮 Play Again
              </button>
              <button onClick={disconnect} className="action-btn flex-1" style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
                🚪 Disconnect Wallet
              </button>
            </div>
          </div>
        );
        break;

      case 'ended':
        contentToRender = (
          <div className="game-card">
            <p className="status">Game Ended</p>
            <p className="text-white">This game has concluded or was cancelled.</p>
            <button onClick={handlePlayAgain} className="action-btn mt-6">
              Play Another Game
            </button>
          </div>
        );
        break;

      default:
        contentToRender = (
          <p className="text-center text-white mt-20 status">Loading game state...</p>
        );
        break;
    }
  }

  return (
    <div className="min-h-screen">
      {/* Floating orbs background */}
      <div className="floating-orbs">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="orb"
            style={{
              width: `${Math.random() * 100 + 50}px`,
              height: `${Math.random() * 100 + 50}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 6}s`,
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="container">
        <div className="game-card">
          <h1 className="title">🎮 CRYPTO ELIMINATION 🎮</h1>

          {errorMessage && <p className="error">Error: {errorMessage}</p>}
          {successMessage && <p className="success">Success: {successMessage}</p>}

          {contentToRender}
        </div>
      </div>
    </div>
  );
}