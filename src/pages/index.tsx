'use client';
import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

export default function Home() {
  const { publicKey, connect, disconnect, connected } = useWallet();

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
            onClick={() => {
              /* TODO: Implement join multiplayer game */
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
        </div>
      )}
    </div>
  );
} 