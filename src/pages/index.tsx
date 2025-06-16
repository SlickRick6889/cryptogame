'use client';
import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useGame } from '../context/GameContext';

export default function Home() {
  const { publicKey, sendTransaction, connect, disconnect, connected } = useWallet();
  const { connection } = useConnection();
  const { joinLobby, gameData, gameId } = useGame();
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-5xl font-extrabold mb-8">🚀 Crypto Elimination</h1>
      {!connected ? (
        <button
          className="bg-indigo-600 hover:bg-indigo-500 px-8 py-4 rounded-lg text-lg font-semibold"
          onClick={connect}
        >
          👻 Connect Wallet
        </button>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-lg">Connected: {publicKey?.toBase58().slice(0, 8)}…</p>
          <button
            className="bg-green-600 hover:bg-green-500 px-6 py-3 rounded-lg font-medium"
            disabled={loading}
            onClick={async () => {
              if (!publicKey || !connection) return;
              setLoading(true);
              try {
                const address = publicKey.toBase58();
                const result = await joinLobby(address);
                if (!result.success && result.requiresPayment) {
                  // Process SOL payment
                  const lamports = Math.floor(result.entryFee * LAMPORTS_PER_SOL);
                  const txn = new Transaction().add(
                    SystemProgram.transfer({
                      fromPubkey: publicKey,
                      toPubkey: new PublicKey(result.treasuryAddress),
                      lamports,
                    })
                  );
                  const sig = await sendTransaction(txn, connection);
                  await connection.confirmTransaction(sig, 'confirmed');
                  // Retry join
                  await joinLobby(address, sig);
                }
              } catch (err) {
                console.error('Join error:', err);
              }
              setLoading(false);
            }}
          >
            🎯 Join Multiplayer Game
          </button>
          <button
            className="bg-red-600 hover:bg-red-500 px-6 py-3 rounded-lg font-medium"
            onClick={disconnect}
          >
            🔌 Disconnect
          </button>
          {gameId && <p className="text-sm">Game ID: {gameId}</p>}
        </div>
      )}
    </div>
  );
} 