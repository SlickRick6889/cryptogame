import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';

// Treasury wallet where entry fees are sent
const TREASURY_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';

// Game configuration
const ENTRY_FEE_SOL = 0.05; // 0.05 SOL entry fee
const DEVNET_RPC = 'https://api.devnet.solana.com';

// Test token for prizes (DUMMY token from Credix faucet)
const PRIZE_TOKEN_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

export class PaymentService {
  private connection: Connection;
  
  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
  }

  /**
   * Charge entry fee from player wallet
   */
  async chargeEntryFee(wallet: WalletContextState, gameId: string): Promise<string | null> {
    if (!wallet.connected || !wallet.publicKey || !wallet.sendTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      console.log('💰 Charging entry fee:', ENTRY_FEE_SOL, 'SOL');
      
      // Create transfer instruction
      const treasuryPublicKey = new PublicKey(TREASURY_WALLET);
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: treasuryPublicKey,
        lamports: ENTRY_FEE_SOL * LAMPORTS_PER_SOL
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
   * Distribute tokens to winner (calls Firebase function)
   */
  async distributeTokensToWinner(winnerWallet: string, gameId: string): Promise<boolean> {
    try {
      console.log('🏆 Distributing tokens to winner:', winnerWallet);
      
      // This would call our Firebase function to handle token distribution
      const response = await fetch('https://us-central1-website-6889.cloudfunctions.net/distributeTokensToWinners', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            gameId,
            winners: [winnerWallet],
            tokenAmountPerWinner: 100, // 100 DUMMY tokens
            tokenMint: PRIZE_TOKEN_MINT
          }
        }),
      });

      const result = await response.json();
      
      if (result.result?.success) {
        console.log('✅ Tokens distributed successfully!');
        return true;
      } else {
        console.error('❌ Token distribution failed:', result);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error distributing tokens:', error);
      return false;
    }
  }

  /**
   * Record game payment in Firebase
   */
  async recordGamePayment(playerWallet: string, gameId: string, signature: string): Promise<boolean> {
    try {
      console.log('📝 Recording game payment...');
      
      const response = await fetch('https://us-central1-website-6889.cloudfunctions.net/recordGamePayment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            playerWallet,
            gameId,
            feeAmount: ENTRY_FEE_SOL,
            transactionSignature: signature
          }
        }),
      });

      const result = await response.json();
      
      if (result.result?.success) {
        console.log('✅ Payment recorded successfully!');
        return true;
      } else {
        console.error('❌ Payment recording failed:', result);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error recording payment:', error);
      return false;
    }
  }

  /**
   * Check if wallet has enough SOL for entry fee
   */
  async checkWalletBalance(publicKey: PublicKey): Promise<{ hasEnough: boolean; balance: number }> {
    try {
      const balance = await this.connection.getBalance(publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      return {
        hasEnough: solBalance >= ENTRY_FEE_SOL + 0.01, // Entry fee + transaction fee
        balance: solBalance
      };
    } catch (error) {
      console.error('❌ Error checking balance:', error);
      return { hasEnough: false, balance: 0 };
    }
  }
}

export const paymentService = new PaymentService(); 