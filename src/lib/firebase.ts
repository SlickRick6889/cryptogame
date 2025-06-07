// Firebase client configuration
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyATBlYvA_dZrQNSdC8F3v7mu8mFYZQAGes",
  authDomain: "website-6889.firebaseapp.com",
  projectId: "website-6889",
  storageBucket: "website-6889.firebasestorage.app",
  messagingSenderId: "606064079207",
  appId: "1:606064079207:web:35dd32a23d0443a873ffc2",
  measurementId: "G-5K76PRT0NZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Game Payment Service
export class GamePaymentService {
  
  // 🎮 Record a game payment (after player pays fee)
  static async recordGamePayment(
    playerWallet: string, 
    gameId: string, 
    feeAmount: number, 
    transactionSignature: string
  ) {
    const recordPayment = httpsCallable(functions, 'recordGamePayment');
    
    try {
      const result = await recordPayment({ 
        playerWallet, 
        gameId, 
        feeAmount, 
        transactionSignature 
      });
      return result.data;
    } catch (error) {
      console.error('Error recording game payment:', error);
      throw error;
    }
  }
  
  // 📊 Get treasury status
  static async getTreasuryStatus() {
    const getStatus = httpsCallable(functions, 'getTreasuryStatus');
    
    try {
      const result = await getStatus({});
      return result.data;
    } catch (error) {
      console.error('Error getting treasury status:', error);
      throw error;
    }
  }
  
  // 🏆 Distribute tokens to winners
  static async distributeTokensToWinners(
    gameId: string, 
    winners: string[], 
    tokenAmountPerWinner: number
  ) {
    const distributeTokens = httpsCallable(functions, 'distributeTokensToWinners');
    
    try {
      const result = await distributeTokens({ 
        gameId, 
        winners, 
        tokenAmountPerWinner 
      });
      return result.data;
    } catch (error) {
      console.error('Error distributing tokens:', error);
      throw error;
    }
  }
  
  // 🔧 Manual token purchase (for testing)
  static async buyTokensManually(solAmount: number) {
    const buyTokens = httpsCallable(functions, 'buyTokensManually');
    
    try {
      const result = await buyTokens({ solAmount });
      return result.data;
    } catch (error) {
      console.error('Error buying tokens manually:', error);
      throw error;
    }
  }
}

// Dev Wallet Configuration
export const DEV_WALLET_CONFIG = {
  // This will be your main treasury wallet address
  address: process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS || 'YOUR_DEV_WALLET_ADDRESS',
  
  // Generate payment instructions for players
  generatePaymentInstructions(feeAmount: number, gameId: string) {
    return {
      recipient: this.address,
      amount: feeAmount,
      gameId,
      instructions: [
        `💰 **Game Entry Fee: ${feeAmount} SOL**`,
        `📍 **Send to:** \`${this.address}\``,
        `🎮 **Game ID:** ${gameId}`,
        '',
        '✅ **What happens next:**',
        '1. Your SOL payment is received',
        '2. STAY tokens are automatically purchased',
        '3. You\'re entered into the game!',
        '4. Winners receive token rewards',
        '',
        '⚡ **Processing:** ~1 minute',
        '🏆 **Play to win!**'
      ].join('\n')
    };
  }
};

// Utility functions
export const formatSOL = (lamports: number) => {
  return (lamports / 1000000000).toFixed(4);
};

export const formatTokens = (amount: number) => {
  return (amount / 1000000).toLocaleString(); // Assuming 6 decimals
}; 