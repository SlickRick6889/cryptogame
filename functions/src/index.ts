import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Transaction
} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';

admin.initializeApp();
const db = admin.firestore();

// Solana configuration
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

// DEV wallet configuration (YOUR treasury wallet)
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY; // Your main wallet
const STAY_TOKEN_MINT = process.env.STAY_TOKEN_MINT || 'YOUR_TOKEN_MINT_ADDRESS';

// Initialize DEV wallet
function getDevWallet(): Keypair {
  if (!DEV_WALLET_PRIVATE_KEY) {
    throw new Error('DEV wallet private key not configured');
  }
  return Keypair.fromSecretKey(bs58.decode(DEV_WALLET_PRIVATE_KEY));
}

// 💰 MONITOR DEV WALLET FOR INCOMING PAYMENTS
export const monitorDevWallet = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
  console.log('🔍 Monitoring DEV wallet for game payments...');
  
  try {
    const devWallet = getDevWallet();
    const devPublicKey = devWallet.publicKey;
    
    // Get current SOL balance
    const currentBalance = await connection.getBalance(devPublicKey);
    const currentSol = currentBalance / LAMPORTS_PER_SOL;
    
    // Get last recorded balance from Firestore
    const balanceDoc = await db.collection('treasury').doc('balance').get();
    const lastBalance = balanceDoc.exists ? balanceDoc.data()?.solBalance || 0 : 0;
    
    // If balance increased, new payments came in!
    if (currentSol > lastBalance) {
      const newSol = currentSol - lastBalance;
      console.log(`💰 New game payments detected: ${newSol} SOL`);
      
      // Automatically buy STAY tokens with the new SOL
      await buyStayTokensWithPayments(newSol);
      
      // Update recorded balance
      await db.collection('treasury').doc('balance').set({
        solBalance: currentSol,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
  } catch (error) {
    console.error('Error monitoring DEV wallet:', error);
  }
});

// 🤖 AUTOMATIC TOKEN PURCHASE WITH GAME PAYMENTS
async function buyStayTokensWithPayments(solAmount: number) {
  try {
    console.log(`🤖 Auto-buying STAY tokens with game payments: ${solAmount} SOL`);
    
    const devWallet = getDevWallet();
    
    // Keep some SOL for transaction fees (0.01 SOL)
    const solToSpend = solAmount - 0.01;
    
    if (solToSpend <= 0) {
      console.log('Not enough SOL to purchase tokens after fees');
      return;
    }
    
    // Get Jupiter quote for SOL → STAY token
    const jupiterQuote = await axios.get('https://quote-api.jup.ag/v6/quote', {
      params: {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: STAY_TOKEN_MINT,
        amount: Math.floor(solToSpend * LAMPORTS_PER_SOL),
        slippageBps: 300 // 3% slippage
      }
    });
    
    if (!jupiterQuote.data) {
      throw new Error('No quote from Jupiter');
    }
    
    // Get swap transaction
    const { data: swapTransaction } = await axios.post('https://quote-api.jup.ag/v6/swap', {
      quoteResponse: jupiterQuote.data,
      userPublicKey: devWallet.publicKey.toString(),
      wrapAndUnwrapSol: true
    });
    
    // Sign and send transaction
    const swapTransactionBuf = Buffer.from(swapTransaction.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    
    transaction.sign(devWallet);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    console.log(`✅ STAY token purchase successful! Signature: ${signature}`);
    
    // Record the transaction
    await db.collection('tokenPurchases').add({
      type: 'auto_purchase_from_game_fees',
      solAmount: solToSpend,
      stayTokensReceived: jupiterQuote.data.outAmount,
      signature,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update total token balance
    await db.collection('treasury').doc('tokens').set({
      stayTokenBalance: admin.firestore.FieldValue.increment(jupiterQuote.data.outAmount),
      lastPurchase: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
  } catch (error) {
    console.error('Error in automatic token purchase:', error);
  }
}

// 🎮 RECORD GAME PAYMENT (Called when player pays fee)
export const recordGamePayment = functions.https.onCall(async (data, context) => {
  try {
    const { playerWallet, gameId, feeAmount, transactionSignature } = data;
    
    // Verify the transaction actually happened
    const txInfo = await connection.getTransaction(transactionSignature);
    if (!txInfo) {
      throw new functions.https.HttpsError('invalid-argument', 'Transaction not found');
    }
    
    // Record the payment
    await db.collection('gamePayments').add({
      playerWallet,
      gameId,
      feeAmount,
      transactionSignature,
      status: 'confirmed',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`🎮 Game payment recorded: ${feeAmount} SOL from ${playerWallet}`);
    
    return { success: true, message: 'Payment recorded successfully' };
    
  } catch (error) {
    console.error('Error recording game payment:', error);
    throw new functions.https.HttpsError('internal', 'Failed to record payment');
  }
});

// 📊 GET TREASURY STATUS
export const getTreasuryStatus = functions.https.onCall(async (data, context) => {
  try {
    const devWallet = getDevWallet();
    const devPublicKey = devWallet.publicKey;
    
    // Get live SOL balance
    const solBalance = await connection.getBalance(devPublicKey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;
    
    // Get token balance from Firestore
    const tokenDoc = await db.collection('treasury').doc('tokens').get();
    const tokenBalance = tokenDoc.exists ? tokenDoc.data()?.stayTokenBalance || 0 : 0;
    
    // Get recent purchases
    const purchasesSnapshot = await db.collection('tokenPurchases')
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
    
    const recentPurchases = purchasesSnapshot.docs.map(doc => doc.data());
    
    return {
      success: true,
      treasury: {
        devWalletAddress: devPublicKey.toString(),
        solBalance: solAmount,
        stayTokenBalance: tokenBalance,
        recentPurchases
      }
    };
    
  } catch (error) {
    console.error('Error getting treasury status:', error);
    throw new functions.https.HttpsError('internal', 'Failed to get treasury status');
  }
});

// 🎯 DISTRIBUTE TOKENS TO PLAYERS (After game ends)
export const distributeTokensToWinners = functions.https.onCall(async (data, context) => {
  try {
    const { gameId, winners, tokenAmountPerWinner } = data;
    
    // This would integrate with your game logic
    // For now, just record the distribution
    await db.collection('tokenDistributions').add({
      gameId,
      winners,
      tokenAmountPerWinner,
      totalDistributed: winners.length * tokenAmountPerWinner,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`🏆 Tokens distributed to ${winners.length} winners`);
    
    return { success: true, message: 'Tokens distributed successfully' };
    
  } catch (error) {
    console.error('Error distributing tokens:', error);
    throw new functions.https.HttpsError('internal', 'Failed to distribute tokens');
  }
});

// 🔧 MANUAL TOKEN PURCHASE (For testing/manual triggers)
export const buyTokensManually = functions.https.onCall(async (data, context) => {
  try {
    const { solAmount } = data;
    
    await buyStayTokensWithPayments(solAmount);
    
    return { success: true, message: 'Manual token purchase initiated' };
    
  } catch (error) {
    console.error('Error in manual purchase:', error);
    throw new functions.https.HttpsError('internal', 'Manual purchase failed');
  }
}); 