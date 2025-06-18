'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useGame } from '../context/GameContext';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Home() {
  const { publicKey, sendTransaction, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const { joinLobby, requestRefund, playerAction, gameData, gameId, fastGameTick } = useGame();
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionClicked, setActionClicked] = useState(false);
  const lastRoundRef = useRef<string | null>(null);
  const buttonAppearanceTimeRef = useRef<number | null>(null);

  // Debug logging
  useEffect(() => {
    console.log('Component mounted. Connected:', connected, 'PublicKey:', publicKey?.toBase58());
  }, [connected, publicKey]);

  // Load game config: entryFeeSol, prizeTokenMintAddress
  const [config, setConfig] = useState<{ 
    entryFeeSol: number; 
    prizeTokenMintAddress: string; 
    tokenSymbol: string;
    treasuryWallet: string;
    rpcUrl: string;
    network: string;
    maxPlayersPerGame: number;
  } | null>(null);
  
  // Dynamic prize estimation
  const [prizeEstimate, setPrizeEstimate] = useState<string>('Loading...');
  
  // Function to get live token price estimate
  const updatePrizeEstimate = async (solAmount: number) => {
    if (!config || solAmount <= 0) {
      setPrizeEstimate('Loading...');
      return;
    }
    
    try {
      // Get Jupiter quote for SOL -> USDC conversion
      const lamports = Math.floor(solAmount * 1000000000); // Convert SOL to lamports
      const quoteParams = new URLSearchParams({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: config.prizeTokenMintAddress, // USDC
        amount: lamports.toString(),
        slippageBps: '300' // 3% slippage
      });
      
      const response = await fetch(`https://quote-api.jup.ag/v6/quote?${quoteParams}`);
      const data = await response.json();
      
      if (data && data.outAmount) {
        // USDC has 6 decimals
        const tokenAmount = parseInt(data.outAmount) / Math.pow(10, 6);
        setPrizeEstimate(`~${tokenAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      } else {
        setPrizeEstimate('Error getting quote');
      }
    } catch (error) {
      console.error('Failed to get prize estimate:', error);
      setPrizeEstimate('Quote unavailable');
    }
  };
  
     // Update prize estimate when game data changes
   useEffect(() => {
     if (gameData && config) {
       const totalSol = config.entryFeeSol * gameData.playerCount;
       updatePrizeEstimate(totalSol);
     }
   }, [gameData, config]);

   // Load config from Firebase
   useEffect(() => {
     (async () => {
       try {
         console.log('Loading game config...');
         const snap = await getDoc(firestoreDoc(db, 'config', 'game'));
         if (snap.exists()) {
           const data = snap.data();
           console.log('Config loaded:', data);
           setConfig({ 
             entryFeeSol: data.entryFee || 0.01, // Use entryFee from Firebase
             prizeTokenMintAddress: data.prizeTokenMintAddress || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 
             tokenSymbol: data.tokenSymbol || 'USDC',
             treasuryWallet: data.treasuryWallet || 'E6xLj38Y2nuhKx2f8wCLJnYAuMZq86m1A7ArD7be8r7h',
             rpcUrl: data.rpcUrl || 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389',
             network: data.network || 'mainnet',
             maxPlayersPerGame: data.maxPlayersPerGame || 5
           });
         } else {
           console.log('No config document found, using defaults');
           setConfig({
             entryFeeSol: 0.01,
             prizeTokenMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
             tokenSymbol: 'USDC',
             treasuryWallet: 'E6xLj38Y2nuhKx2f8wCLJnYAuMZq86m1A7ArD7be8r7h',
             rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389',
             network: 'mainnet',
             maxPlayersPerGame: 5
           });
         }
       } catch (err: any) {
         console.error('Failed to load config:', err);
         setErrorMessage(`Failed to load game configuration: ${err.message || err}`);
         // Set default config even if loading fails
         setConfig({
           entryFeeSol: 0.01,
           prizeTokenMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
           tokenSymbol: 'USDC',
           treasuryWallet: 'E6xLj38Y2nuhKx2f8wCLJnYAuMZq86m1A7ArD7be8r7h',
           rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389',
           network: 'mainnet',
           maxPlayersPerGame: 5
         });
       }
     })();
   }, []);
 
   // Lobby countdown (15s)
  const [lobbyRemaining, setLobbyRemaining] = useState(0);
  useEffect(() => {
    if (!gameData || gameData.status !== 'lobby' || !gameData.countdownStartedAt) return;
    const duration = gameData.countdownDuration || 15;
    const startMs = gameData.countdownStartedAt.toMillis();
    const iv = setInterval(() => {
      const secs = Math.max(0, duration - (Date.now() - startMs) / 1000);
      setLobbyRemaining(Math.ceil(secs));
      
      // When countdown reaches 0, trigger game processing
      if (secs <= 0) {
        clearInterval(iv);
        console.log('⏰ Lobby countdown expired - triggering game tick');
        // Trigger the fastGameTick function to process game state
        fastGameTick().catch((err: any) => {
          console.error('Failed to trigger game tick:', err);
        });
      }
    }, 200);
    return () => clearInterval(iv);
  }, [gameData, fastGameTick]);

  // Round countdown (5s) - Use ref to prevent multiple triggers
  const [roundRemaining, setRoundRemaining] = useState(0);
  const processingTriggeredRef = useRef<string>('');
  
  useEffect(() => {
    if (!gameData || gameData.status !== 'in_progress' || !gameData.roundStartedAt) return;
    const duration = gameData.roundDurationSec || 5;
    const startMs = gameData.roundStartedAt.toMillis();
    const roundKey = `${gameData.round}-${startMs}`;
    
    // Reset action state for new round only
    const currentRoundKey = `${gameData.round}-${startMs}`;
    if (lastRoundRef.current !== currentRoundKey) {
      console.log(`🔄 New round detected: ${currentRoundKey} (was: ${lastRoundRef.current})`);
      setActionClicked(false);
      setSuccessMessage(null);
      setErrorMessage(null);
      lastRoundRef.current = currentRoundKey;
      
      // Record when the button appears for THIS player locally
      buttonAppearanceTimeRef.current = Date.now();
      console.log(`⏰ Button appeared at: ${buttonAppearanceTimeRef.current} (local time)`);
    }
    
    const iv = setInterval(() => {
      const secs = Math.max(0, duration - (Date.now() - startMs) / 1000);
      setRoundRemaining(Math.ceil(secs));
      
      // When round timer expires, trigger processing after 3-second delay (ONLY ONCE PER ROUND)
      if (secs <= 0 && processingTriggeredRef.current !== roundKey) {
        clearInterval(iv);
        processingTriggeredRef.current = roundKey;
        console.log(`⏰ Round ${gameData.round} countdown expired - triggering processing in 1 second`);
        
        // Wait 1 second for player actions to be submitted, then trigger processing
        setTimeout(() => {
          console.log(`🔄 Calling fastGameTick for round ${gameData.round}...`);
          fastGameTick().catch((err: any) => {
            console.error('Failed to trigger round processing:', err);
          });
        }, 1000);
      }
    }, 200);
    return () => clearInterval(iv);
  }, [gameData?.round, gameData?.roundStartedAt?.toMillis(), gameData?.status, fastGameTick]);

  // Handlers
  const handleJoin = async () => {
    console.log("handleJoin called"); // Debug log
    if (!publicKey || !connection || !config) {
      setErrorMessage('Wallet not connected or config not loaded.');
      console.log("handleJoin - pre-checks failed"); // Debug log
      return;
    }
    setLoadingJoin(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const address = publicKey.toBase58();
    try {
      const res = await joinLobby(address);
      if (!res.success && res.requiresPayment && res.treasuryAddress) {
        const lamports = Math.floor(config.entryFeeSol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(res.treasuryAddress), lamports })
        );
        tx.feePayer = publicKey; // Set fee payer for simulation
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Simulate transaction for user feedback (optional)
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

        const sig = await sendTransaction(tx, connection);
        setSuccessMessage('Transaction sent: ' + sig.slice(0, 8) + '...');
        await connection.confirmTransaction(sig, 'confirmed');
        setSuccessMessage('Transaction confirmed. Joining lobby...');
        await joinLobby(address, sig); // Re-call joinLobby with signature
      } else if (!res.success && res.message) {
        setErrorMessage(`Failed to join lobby: ${res.message}`);
      }
    } catch (err: any) {
      console.error('joinLobby error:', err);
      setErrorMessage(`Error joining lobby: ${err.message || err}`);
    }
    setLoadingJoin(false);
    console.log("handleJoin finished. loadingJoin set to false"); // Debug log
  };

  const handleAction = async () => {
    if (!publicKey || !gameData || roundRemaining <= 0 || actionClicked) return;
    
    // Record click time immediately
    const clickTime = Date.now();
    const buttonAppearTime = buttonAppearanceTimeRef.current;
    
    if (!buttonAppearTime) {
      console.error('❌ Button appearance time not recorded!');
      setErrorMessage('Timing error - please try again');
      return;
    }
    
    // Calculate LOCAL response time (no network sync issues!)
    const localResponseTime = clickTime - buttonAppearTime;
    
    console.log(`🖱️ CLICK! Button appeared: ${buttonAppearTime}, Clicked: ${clickTime}, Response time: ${localResponseTime}ms`);
    
    // Immediately show clicked state
    setActionClicked(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      // Send the LOCAL response time, not server-calculated time
      await playerAction({ 
        gameId: gameId!, 
        playerAddress: publicKey.toBase58(), 
        clientTimestamp: clickTime,
        clientResponseTime: localResponseTime, // This is the accurate local time
        buttonAppearanceTime: buttonAppearTime, // Send this for verification
        roundStartTime: gameData.roundStartedAt.toMillis() // Still send for backend reference
      });
      
      setSuccessMessage(`✅ Clicked in ${localResponseTime}ms!`);
      console.log(`✅ Player action successful! Local response time: ${localResponseTime}ms`);
    } catch (err: any) {
      console.error('playerAction error:', err);
      setErrorMessage(`❌ Error: ${err.message || err}`);
      setActionClicked(false); // Reset on error
    }
  };

  const handleRefund = async () => {
    if (!publicKey || !gameId) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await requestRefund(gameId, publicKey.toBase58());
      setSuccessMessage('Refund request sent!');
    } catch (err: any) {
      console.error('refund error:', err);
      setErrorMessage(`Error requesting refund: ${err.message || err}`);
    }
  };

  const getPlayerStatus = (playerAddress: string) => {
    if (gameData && gameData.players && gameData.players[playerAddress]) {
      return gameData.players[playerAddress].status;
    }
    return 'unknown';
  };

  let contentToRender = null;
  // console.log('Rendering: { connected:', connected, ', gameId:', gameId, ', gameDataStatus:', gameData?.status, '}');

  if (!connected) {
    contentToRender = (
      // Wallet Connection Section
      <div id="wallet-section">
        <div style={{ marginBottom: '20px', color: '#00ffff' }}>
          <p>🚀 Connect your Solana wallet to start playing!</p>
          <p style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '10px' }}>
            Supports all major wallets with mobile deep linking!
          </p>
        </div>
        <div>
          <WalletMultiButton className="wallet-btn" />
        </div>
        <div id="wallet-status" className="text-sm mt-2">
          {connected ? `Connected: ${publicKey?.toBase58().slice(0, 8)}...` : 'Not Connected'}
        </div>
      </div>
    );
  } else if (!gameId) {
    contentToRender = (
      // Game Lobby Section
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
    contentToRender = (
      <p className="text-center text-white">Loading game data...</p>
    );
  } else {
    // Game States (Waiting, Lobby, In-Progress, Completed)
    switch (gameData.status) {
      case 'waiting':
        contentToRender = (
          <div id="waiting-section">
            <p className="status" id="waiting-status">⏳ Waiting for Players...</p>
            <div style={{ margin: '20px 0', color: '#00ffff' }}>
              <p id="game-id-display" className="text-lg mb-2">Game ID: {gameId}</p>
              <p id="player-count-display" className="text-base mb-4">Players: {gameData.playerCount}/{gameData.maxPlayers}</p>
              <p id="current-pot-display" className="text-lg text-green-400 font-bold my-2">
                💰 Current Pot: {config ? (config.entryFeeSol * gameData.playerCount).toFixed(2) : 'Loading...'} SOL
              </p>
              <p className="text-lg text-yellow-400 font-bold my-2">
                🏆 Prize Estimate: {prizeEstimate} {config?.tokenSymbol || 'USDC'}
              </p>
              <p id="countdown-display" className="text-3xl text-red-500 my-4">{lobbyRemaining > 0 ? `Starts in: ${lobbyRemaining}s` : 'Starting Soon!'}</p>
              <p id="waiting-message" className="text-gray-400 text-sm">{gameData.statusMessage || ''}</p>
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
            {lobbyRemaining <= 0 && (
              <button 
                className="action-btn" 
                onClick={() => fastGameTick().catch((err: any) => console.error('Manual game tick failed:', err))}
                style={{ background: 'linear-gradient(45deg, #ff8800, #ffaa00)', marginTop: '10px' }}
              >
                🚀 FORCE START GAME
              </button>
            )}
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
        const pk = publicKey!.toBase58();
        // The `me` and `alive` variables are not directly used in the JSX below
        // const me = gameData.players[pk];
        // const alive = me?.status === 'alive';
        contentToRender = (
          <div id="game-section">
            <p className="status" id="game-status">ELIMINATION ROUND {gameData.round}</p>
            <p className="timer" id="timer">{roundRemaining}</p>
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
            <div className="mt-4 text-left px-8">
              <h3 className="text-xl font-bold text-blue-300 mb-2">Players:</h3>
              <ul className="list-disc list-inside">
                {Object.entries(gameData.players).map(([address, player]) => (
                  <li key={address} className={player.status === 'alive' ? 'text-green-300' : 'text-red-500 line-through'}>
                    {address.slice(0, 8)}... - {player.status === 'alive' ? 'Alive' : 'Eliminated'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
        break;
      case 'completed':
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
            <button onClick={() => { /* Handle play again - e.g., reset context or navigate */ }} className="action-btn mt-6">
              Play Again
            </button>
          </div>
        );
        break;
      case 'ended':
        contentToRender = (
          <div className="game-card">
            <p className="status">Game Ended</p>
            <p className="text-white">This game has concluded or was cancelled.</p>
            <button onClick={() => { /* Handle play again */ }} className="action-btn mt-6">
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