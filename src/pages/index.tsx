'use client';
import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useGame } from '../context/GameContext';

export default function Home() {
  const { publicKey, sendTransaction, connect, disconnect, connected } = useWallet();
  const { connection } = useConnection();
  const { joinLobby, requestRefund, playerAction, gameData, gameId } = useGame();
  const [loadingJoin, setLoadingJoin] = useState(false);

  // Load game config: entryFeeSol, prizeTokenMintAddress
  const [config, setConfig] = useState<{ entryFeeSol: number; prizeTokenMintAddress: string } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(firestoreDoc(db, 'config', 'game'));
        if (snap.exists()) {
          const data = snap.data();
          setConfig({ entryFeeSol: data.entryFee, prizeTokenMintAddress: data.prizeTokenMintAddress });
        }
      } catch (err) {
        console.error('Failed to load config:', err);
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
    }, 200);
    return () => clearInterval(iv);
  }, [gameData]);

  // Handlers
  const handleJoin = async () => {
    if (!publicKey || !connection || !config) return;
    setLoadingJoin(true);
    const address = publicKey.toBase58();
    try {
      const res = await joinLobby(address);
      if (!res.success && res.requiresPayment) {
        const lamports = Math.floor(config.entryFeeSol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(res.treasuryAddress), lamports })
        );
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
        await joinLobby(address, sig);
      }
    } catch (err) {
      console.error('joinLobby error:', err);
    }
    setLoadingJoin(false);
  };

  const handleAction = async () => {
    if (!publicKey || !gameData || roundRemaining <= 0) return;
    try {
      const now = Date.now();
      const rt = now - gameData.roundStartedAt.toMillis();
      await playerAction({ gameId: gameId!, playerAddress: publicKey.toBase58(), clientTimestamp: now, clientResponseTime: rt, roundStartTime: gameData.roundStartedAt.toMillis() });
    } catch (err) {
      console.error('playerAction error:', err);
    }
  };

  const handleRefund = async () => {
    if (!publicKey || !gameId) return;
    try {
      await requestRefund(gameId, publicKey.toBase58());
    } catch (err) {
      console.error('refund error:', err);
    }
  };

  // Render by status
  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <button onClick={connect} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded">
          Connect Wallet
        </button>
      </div>
    );
  }

  if (!gameId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-4">
        <p className="text-white">Connected: {publicKey?.toBase58().slice(0,8)}…</p>
        <button onClick={handleJoin} disabled={loadingJoin} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded">
          {loadingJoin ? 'Joining…' : 'Join Multiplayer Game'}
        </button>
        <button onClick={disconnect} className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded">
          Disconnect
        </button>
      </div>
    );
  }

  if (!gameData) {
    return <p className="text-center text-white">Loading game...</p>;
  }

  const { status, playerCount, maxPlayers, players, prize, winner } = gameData;

  switch (status) {
    case 'waiting':
      return (
        <div className="min-h-screen flex flex-col items-center justify-center space-y-4 text-white">
          <p>Game {gameId} waiting for players ({playerCount}/{maxPlayers})</p>
          <button onClick={handleRefund} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded">
            Leave & Refund
          </button>
        </div>
      );
    case 'lobby':
      return (
        <div className="min-h-screen flex flex-col items-center justify-center space-y-2 text-white">
          <p>Game {gameId}</p>
          <p>Starts in: {lobbyRemaining}s</p>
          <p>Players: {playerCount}/{maxPlayers}</p>
          {config && <p>Pot: {(config.entryFeeSol * playerCount).toFixed(2)} SOL</p>}
        </div>
      );
    case 'starting':
      return <p className="text-center text-white mt-20">Game is starting…</p>;
    case 'in_progress': {
      const pk = publicKey!.toBase58();
      const me = players[pk];
      const alive = me?.status === 'alive';
      return (
        <div className="min-h-screen flex flex-col items-center justify-center space-y-4 text-white">
          <p>Round {gameData.round} / Alive: {Object.values(players).filter(p=>p.status==='alive').length}</p>
          <p>Time left: {roundRemaining}s</p>
          <button onClick={handleAction} disabled={!alive || roundRemaining<=0} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded">
            {alive ? 'Click to Survive!' : 'Eliminated'}
          </button>
        </div>
      );
    }
    case 'completed':
      const pk = publicKey!.toBase58();
      const isWinner = winner === pk;
      return (
        <div className="min-h-screen flex flex-col items-center justify-center space-y-4 text-white">
          {isWinner ? (
            <p className="text-green-400 text-2xl">🎉 You won! Prize: {prize?.prizeAmountFormatted} {prize?.tokenSymbol}</p>
          ) : (
            <p className="text-red-400 text-2xl">Game over! Winner: {winner?.slice(0,8)}…</p>
          )}
          <button onClick={disconnect} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded">
            Play Again
          </button>
        </div>
      );
    default:
      return null;
  }
} 