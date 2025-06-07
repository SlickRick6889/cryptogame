import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { 
  Connection, 
  Keypair, 
  LAMPORTS_PER_SOL,
  Transaction,
  PublicKey
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import axios from 'axios';
import bs58 from 'bs58';

admin.initializeApp();
const db = admin.firestore();

// Solana configuration
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

// DEV wallet configuration (TEST treasury wallet for devnet)
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY || '5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp'; // Test wallet private key
const STAY_TOKEN_MINT = process.env.STAY_TOKEN_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'; // DUMMY token from Credix faucet

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
    
    console.log(`📊 DEV wallet balance: ${currentSol} SOL`);
    
    // Get last recorded balance from Firestore
    const balanceDoc = await db.collection('treasury').doc('balance').get();
    const lastBalance = balanceDoc.exists ? balanceDoc.data()?.solBalance || 0 : 0;
    
    // If balance increased, new payments came in!
    if (currentSol > lastBalance) {
      const newSol = currentSol - lastBalance;
      console.log(`💰 New game payments detected: ${newSol} SOL`);
      
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

// 🧪 SIMPLE TEST FUNCTION
export const testFunction = functions.https.onCall(async (data, context) => {
  try {
    return {
      success: true,
      message: 'Test function working!',
      timestamp: new Date().toISOString(),
      config: {
        solana_rpc: SOLANA_RPC,
        stay_token_mint: STAY_TOKEN_MINT,
        has_private_key: !!DEV_WALLET_PRIVATE_KEY
      }
    };
  } catch (error) {
    console.error('Error in test function:', error);
    throw new functions.https.HttpsError('internal', 'Test function failed');
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
    const { gameId, winners, tokenAmountPerWinner, tokenMint } = data;
    
    console.log(`🏆 Starting token distribution for game ${gameId}`);
    console.log(`Winners: ${winners.length}, Amount each: ${tokenAmountPerWinner}, Token: ${tokenMint}`);
    
    const devWallet = getDevWallet();
    const tokenMintPubkey = new PublicKey(tokenMint || STAY_TOKEN_MINT);
    
    // Get dev wallet's token account
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      devWallet.publicKey
    );
    
    const results = [];
    
    // Send tokens to each winner
    for (const winnerAddress of winners) {
      try {
        console.log(`💰 Sending ${tokenAmountPerWinner} DUMMY tokens to ${winnerAddress}`);
        
        const winnerPubkey = new PublicKey(winnerAddress);
        
        // Get or create winner's token account
        const winnerTokenAccount = await getAssociatedTokenAddress(
          tokenMintPubkey,
          winnerPubkey
        );
        
        // Check if winner's token account exists
        const accountInfo = await connection.getAccountInfo(winnerTokenAccount);
        
        const transaction = new Transaction();
        
        // Create token account if it doesn't exist
        if (!accountInfo) {
          console.log(`📝 Creating token account for winner: ${winnerAddress}`);
          const createAccountInstruction = createAssociatedTokenAccountInstruction(
            devWallet.publicKey, // payer
            winnerTokenAccount,   // account to create
            winnerPubkey,         // owner
            tokenMintPubkey       // mint
          );
          transaction.add(createAccountInstruction);
        }
        
        // Add transfer instruction
        const transferInstruction = createTransferInstruction(
          devTokenAccount,      // source
          winnerTokenAccount,   // destination  
          devWallet.publicKey,  // owner
          tokenAmountPerWinner * Math.pow(10, 6), // amount (DUMMY tokens have 6 decimals)
          [],                   // signers
          TOKEN_PROGRAM_ID
        );
        transaction.add(transferInstruction);
        
        // Get recent blockhash and send transaction
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = devWallet.publicKey;
        
        // Sign and send
        transaction.sign(devWallet);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        
        console.log(`✅ Tokens sent to ${winnerAddress}! Signature: ${signature}`);
        
        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');
        
        results.push({
          winner: winnerAddress,
          signature,
          amount: tokenAmountPerWinner,
          status: 'success'
        });
        
      } catch (error) {
        console.error(`❌ Failed to send tokens to ${winnerAddress}:`, error);
        results.push({
          winner: winnerAddress,
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'failed'
        });
      }
    }
    
    // Record the distribution in Firestore
    await db.collection('tokenDistributions').add({
      gameId,
      winners,
      tokenAmountPerWinner,
      tokenMint,
      totalDistributed: winners.length * tokenAmountPerWinner,
      results,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`🎉 Token distribution complete: ${successCount}/${winners.length} successful`);
    
    return { 
      success: true, 
      message: `Tokens distributed to ${successCount}/${winners.length} winners`,
      results 
    };
    
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