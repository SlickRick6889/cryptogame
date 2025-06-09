import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { gameFunction } from './firebase';

// Helper function to format token amounts with decimals
function formatTokenAmount(rawAmount: string | number, decimals: number = 9): string {
  const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
  return formatted;
}

interface GameConfig {
  network: 'devnet' | 'mainnet';
  rpcUrl?: string;
  treasuryAddress?: string;
  tokenSymbol: string;
  entryFee: number;
  maxPlayersPerGame: number;
  autoStartNewGames: boolean;
}

export class PaymentService {
  private connection: Connection | null = null;
  private config: GameConfig | null = null;
  private treasuryWallet: string = '';

  constructor() {
    this.loadConfig();
  }

  /**
   * Load configuration from Firebase
   */
  async loadConfig(): Promise<GameConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      console.log('🔧 Loading game configuration from Firebase...');
      
      // Call gameFunction with getConfig action
      const result = await gameFunction({
        action: 'getConfig'
      });
      
      const data = result.data as any;
      if (data?.success && data?.config) {
        this.config = data.config as GameConfig;
        
        // Set treasury wallet from Firebase config
        this.treasuryWallet = this.config.treasuryAddress || '';
        if (!this.treasuryWallet) {
          throw new Error('Treasury wallet address not configured in Firebase');
        }
        
        // Initialize connection
        const rpcUrl = this.config.rpcUrl || 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389';
        this.connection = new Connection(rpcUrl, 'confirmed');
        
        console.log('✅ Configuration loaded:', this.config);
        console.log('🔗 Using RPC endpoint:', rpcUrl);
        return this.config;
      } else {
        throw new Error('Failed to load configuration from Firebase');
      }
    } catch (error) {
      console.error('❌ Error loading config:', error);
      // Fallback config
      this.config = {
        network: 'mainnet',
        rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=f10bbc12-c465-44a6-8064-ff3113d3c389',
        tokenSymbol: 'BALL',
        entryFee: 0.01,
        maxPlayersPerGame: 1,
        autoStartNewGames: true
      };
      this.connection = new Connection(this.config.rpcUrl!, 'confirmed');
      return this.config;
    }
  }

  /**
   * Get current entry fee
   */
  async getEntryFee(): Promise<number> {
    const config = await this.loadConfig();
    return config?.entryFee || 0.01;
  }

  /**
   * Charge entry fee from player wallet
   */
  async chargeEntryFee(wallet: WalletContextState, gameId: string): Promise<string | null> {
    if (!wallet.connected || !wallet.publicKey || !wallet.sendTransaction) {
      throw new Error('Wallet not connected');
    }

    const config = await this.loadConfig();
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    try {
      console.log('💰 Charging entry fee:', config.entryFee, 'SOL');
      
      // Create transfer instruction
      const treasuryPublicKey = new PublicKey(this.treasuryWallet);
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: treasuryPublicKey,
        lamports: config.entryFee * LAMPORTS_PER_SOL
      });

      // Create transaction
      const transaction = new Transaction().add(transferInstruction);
      
      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      // Send transaction
      const signature = await wallet.sendTransaction(transaction, this.connection);
      
      console.log('✅ Entry fee paid! Signature:', signature);
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');
      
      return signature;
      
    } catch (error) {
      console.error('❌ Error charging entry fee:', error);
      throw error;
    }
  }

  /**
   * Record game payment in Firebase
   */
  async recordGamePayment(playerWallet: string, gameId: string, signature: string): Promise<boolean> {
    try {
      console.log('📝 Recording game payment...');
      const config = await this.loadConfig();
      
      // Call gameFunction with recordPayment action
      const result = await gameFunction({
        action: 'recordPayment',
        playerAddress: playerWallet,
        gameId,
        transactionSignature: signature
      });
      
      const data = result.data as any;
      if (data?.success) {
        console.log('✅ Payment recorded successfully!');
        return true;
      } else {
        console.error('❌ Payment recording failed:', JSON.stringify(data, null, 2));
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error recording payment:', error);
      return false;
    }
  }

  /**
   * Start game and trigger token purchase via Jupiter swap
   */
  async startGameAndPrepareTokens(gameId: string, totalPlayers: number): Promise<{ success: boolean; swapCompleted: boolean; ballTokensAvailable?: number; swapSignature?: string }> {
    try {
      console.log('🎮 Starting game and performing Jupiter swap...');
      
      // Call gameFunction with startGame action
      const result = await gameFunction({
        action: 'startGame',
        gameId,
        totalPlayers
      });
      
      const data = result.data as any;
      if (data?.success) {
        console.log('✅ Game started and Jupiter swap completed!', data.message);
        
        // Check if swap was successful
        const swapCompleted = !data.swapFailed && data.swapSignature;
        
        return {
          success: true,
          swapCompleted,
          ballTokensAvailable: data.ballTokensAvailable || 0,
          swapSignature: data.swapSignature
        };
      } else {
        console.error('❌ Game start failed:', JSON.stringify(data, null, 2));
        return { success: false, swapCompleted: false };
      }
      
    } catch (error) {
      console.error('❌ Error starting game:', error);
      return { success: false, swapCompleted: false };
    }
  }

  /**
   * Distribute tokens to winner
   */
  async distributeTokensToWinner(winnerWallet: string, gameId: string): Promise<any> {
    try {
      console.log('🏆 Distributing tokens to winner:', winnerWallet);
      
      // Call gameFunction with distributeTokens action
      const result = await gameFunction({
        action: 'distributeTokens',
        gameId,
        winnerAddress: winnerWallet
      });
      
      const data = result.data as any;
      if (data?.success) {
        console.log('✅ Tokens distributed successfully!');
        return data;
      } else {
        console.error('❌ Token distribution failed:', JSON.stringify(data, null, 2));
        return { success: false, error: data };
      }
      
    } catch (error) {
      console.error('❌ Error distributing tokens:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Check if wallet has enough SOL for entry fee
   */
  async checkWalletBalance(publicKey: PublicKey): Promise<{ hasEnough: boolean; balance: number }> {
    const config = await this.loadConfig();
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    try {
      const balance = await this.connection.getBalance(publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      return {
        hasEnough: solBalance >= config.entryFee + 0.01, // Entry fee + transaction fee
        balance: solBalance
      };
    } catch (error) {
      console.error('❌ Error checking balance:', error);
      return { hasEnough: false, balance: 0 };
    }
  }
}

export const paymentService = new PaymentService(); 