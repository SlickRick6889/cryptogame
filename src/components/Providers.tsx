'use client';
import React, { ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';

export const AppProviders = ({ children }: { children: ReactNode }) => {
  const network = 'mainnet-beta';
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(network);
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),
  ];

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}; 