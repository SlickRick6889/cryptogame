'use client';
import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useGame } from '../context/GameContext';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Home() {
  const { publicKey, sendTransaction, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const { joinLobby, requestRefund, playerAction, gameData, gameId } = useGame();
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load game config: entryFeeSol, prizeTokenMintAddress
  const [config, setConfig] = useState<{ entryFeeSol: number; prizeTokenMintAddress: string; tokenSymbol: string } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(firestoreDoc(db, 'config', 'game'));
        if (snap.exists()) {
          const data = snap.data();
          setConfig({ 
            entryFeeSol: data.entryFee, 
            prizeTokenMintAddress: data.prizeTokenMintAddress, 
            tokenSymbol: data.tokenSymbol || '$BALL'
          });
        }
      } catch (err: any) {
        console.error('Failed to load config:', err);
        setErrorMessage(`Failed to load game configuration: ${err.message || err}`);
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
      if (secs <= 0) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [gameData]);

  // Round countdown (5s)
  const [roundRemaining, setRoundRemaining] = useState(0);
  useEffect(() => {
    if (!gameData || gameData.status !== 'in_progress' || !gameData.roundStartedAt) return;
    const duration = gameData.roundDurationSec || 5;
    const startMs = gameData.roundStartedAt.toMillis();
    const iv = setInterval(() => {
      const secs = Math.max(0, duration - (Date.now() - startMs) / 1000);
      setRoundRemaining(Math.ceil(secs));
      if (secs <= 0) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [gameData]);

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
    if (!publicKey || !gameData || roundRemaining <= 0) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const now = Date.now();
      const rt = now - gameData.roundStartedAt.toMillis();
      await playerAction({ gameId: gameId!, playerAddress: publicKey.toBase58(), clientTimestamp: now, clientResponseTime: rt, roundStartTime: gameData.roundStartedAt.toMillis() });
      setSuccessMessage('Action recorded!');
    } catch (err: any) {
      console.error('playerAction error:', err);
      setErrorMessage(`Error recording action: ${err.message || err}`);
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

  return (
    <div className="floating-orbs" id="orbs">
      <div className="container">
        <div className="game-card">
          <h1 className="title">🎮 CRYPTO ELIMINATION 🎮</h1>

          {errorMessage && <p className="error">Error: {errorMessage}</p>}
          {successMessage && <p className="success">Success: {successMessage}</p>}

          {!connected ? (
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
          ) : !gameId ? (
            // Game Lobby Section
            <div id="lobby-section">
              <p className="status">🎮 Multiplayer Battle Royale</p>
              <div style={{ margin: '15px 0', color: '#ffff00' }}>
                <p>💰 Entry Fee: {config ? `${config.entryFeeSol} SOL` : 'Loading...'}</p>
                <p>🏆 Prize: Winner takes all SOL (swapped to ${config?.tokenSymbol || 'BALL'} tokens)</p>
                <small style={{ color: '#aaa' }}>Real players only - slowest eliminated each round!</small>
              </div>
              <button className="action-btn" onClick={handleJoin} disabled={loadingJoin}>
                {loadingJoin ? 'Joining...' : '🎯 JOIN MULTIPLAYER GAME'}
              </button>
              <button onClick={disconnect} className="action-btn" style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
                Disconnect
              </button>
            </div>
          ) : !gameData ? (
            <p className="text-center text-white">Loading game data...</p>
          ) : (
            // Game States (Waiting, Lobby, In-Progress, Completed)
            <>
              {gameData.status === 'waiting' && (
                <div id="waiting-section">
                  <p className="status" id="waiting-status">⏳ Waiting for Players...</p>
                  <div style={{ margin: '20px 0', color: '#00ffff' }}>
                    <p id="game-id-display" className="text-lg mb-2">Game ID: {gameId}</p>
                    <p id="player-count-display" className="text-base mb-4">Players: {gameData.playerCount}/{gameData.maxPlayers}</p>
                    <p id="current-pot-display" className="text-lg text-green-400 font-bold my-2">
                      💰 Current Pot: {config ? (config.entryFeeSol * gameData.playerCount).toFixed(2) : 'Loading...'} SOL
                    </p>
                    <p id="countdown-display" className="text-3xl text-red-500 my-4">{lobbyRemaining > 0 ? `Starts in: ${lobbyRemaining}s` : 'Starting Soon!'}</p>
                    <p id="waiting-message" className="text-gray-400 text-sm">{gameData.statusMessage || ''}</p>
                  </div>
                  <button className="action-btn" onClick={handleRefund} style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
                    💰 LEAVE & GET REFUND
                  </button>
                  {/* Force Start and Cleanup buttons - consider if these should be here or admin-only */}
                  {/* <button className="action-btn" onClick={forceStartGame} style={{ background: 'linear-gradient(45deg, #ff8800, #ffaa00)' }}>
                    🚀 FORCE START GAME
                  </button>
                  <button className="action-btn" onClick={cleanupOldGames} style={{ background: 'linear-gradient(45deg, #8800ff, #aa00ff)' }}>
                    🧹 CLEANUP STUCK GAMES
                  </button> */}
                  <p style={{ marginTop: '10px', color: '#aaa', fontSize: '0.8rem' }}>
                    Refund: Entry fee minus 0.0005 SOL transfer fee
                  </p>
                </div>
              )}

              {gameData.status === 'lobby' && (
                <div id="lobby-section-countdown">
                  <p className="status">🎮 Multiplayer Battle Royale</p>
                  <div style={{ margin: '15px 0', color: '#ffff00' }}>
                    <p>💰 Entry Fee: {config ? `${config.entryFeeSol} SOL` : 'Loading...'}</p>
                    <p>🏆 Prize: Winner takes all SOL (swapped to ${config?.tokenSymbol || 'BALL'} tokens)</p>
                    <small style={{ color: '#aaa' }}>Real players only - slowest eliminated each round!</small>
                  </div>
                  <p className="status">⏳ Game Starts in: {lobbyRemaining}s</p>
                  <p className="text-white">Players: {gameData.playerCount}/{gameData.maxPlayers}</p>
                  {config && <p className="text-white">Pot: {(config.entryFeeSol * gameData.playerCount).toFixed(2)} SOL</p>}
                  <button className="action-btn" onClick={handleRefund} style={{ background: 'linear-gradient(45deg, #ff4444, #ff0000)' }}>
                    💰 LEAVE & GET REFUND
                  </button>
                </div>
              )}

              {gameData.status === 'starting' && (
                <p className="text-center text-white mt-20 status">Game is starting…</p>
              )}

              {gameData.status === 'in_progress' && (
                <div id="game-section">
                  <p className="status" id="game-status">ELIMINATION ROUND {gameData.round}</p>
                  <p className="timer" id="timer">{roundRemaining}</p>
                  <p className="players">Alive: {Object.values(gameData.players).filter(p => p.status === 'alive').length}</p>
                  <button onClick={handleAction} disabled={!publicKey || gameData.players[publicKey.toBase58()]?.status !== 'alive' || roundRemaining <= 0} className="action-btn">
                    {publicKey && gameData.players[publicKey.toBase58()]?.status === 'alive' ? 'Click to Survive!' : 'Eliminated'}
                  </button>
                  {/* Display list of players and their status */}
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
              )}

              {gameData.status === 'completed' && (
                <div id="winner-section">
                  {gameData.winner === publicKey?.toBase58() ? (
                    <div className="winner-screen">
                      <p className="text-green-400 text-2xl font-bold mb-4">🎉 YOU ARE THE LAST STANDING DEGEN! 🎉</p>
                      <p className="text-white text-xl">Prize: {gameData.prize?.prizeAmountFormatted} {gameData.prize?.tokenSymbol}</p>
                    </div>
                  ) : (
                    <div className="game-card">
                      <p className="status">Game Over!</p>
                      <p className="text-red-400 text-2xl mb-4">You were eliminated.</p>
                      <p className="text-white text-xl">Winner: {gameData.winner?.slice(0, 8)}...</p>
                      {gameData.prize && <p className="text-white text-md">Prize: {gameData.prize?.prizeAmountFormatted} {gameData.prize?.tokenSymbol}</p>}
                    </div>
                  )}
                  <button onClick={() => { /* Handle play again - e.g., reset context or navigate */ }} className="action-btn mt-6">
                    Play Again
                  </button>
                </div>
              )}

              {gameData.status === 'ended' && (
                <div className="game-card">
                  <p className="status">Game Ended</p>
                  <p className="text-white">This game has concluded or was cancelled.</p>
                  <button onClick={() => { /* Handle play again */ }} className="action-btn mt-6">
                    Play Another Game
                  </button>
                </div>
              )}

              {/* Fallback for unhandled statuses or initial loading after gameData is fetched */}
              {!['waiting', 'lobby', 'starting', 'in_progress', 'completed', 'ended'].includes(gameData.status) && (
                <p className="text-center text-white mt-20 status">Loading game state...</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
} 