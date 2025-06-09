'use client';
import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { GameProvider } from '@/contexts/GameContext';

require('@solana/wallet-adapter-react-ui/styles.css');

interface ProvidersProps {
  children: React.ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  // Use mainnet for production
  const network = WalletAdapterNetwork.Mainnet;
  
  // Use mainnet RPC endpoint
  const endpoint = useMemo(() => 
    'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389',
    []
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
    ],
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={false}
        onError={(error) => {
          console.error('Wallet error:', error);
        }}
      >
        <WalletModalProvider>
          <GameProvider>
            {children}
          </GameProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
} 