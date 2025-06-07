"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buyTokensManually = exports.distributeTokensToWinners = exports.getTreasuryStatus = exports.testFunction = exports.recordGamePayment = exports.monitorDevWallet = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const axios_1 = __importDefault(require("axios"));
const bs58_1 = __importDefault(require("bs58"));
admin.initializeApp();
const db = admin.firestore();
// Solana configuration
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const connection = new web3_js_1.Connection(SOLANA_RPC, 'confirmed');
// DEV wallet configuration (TEST treasury wallet for devnet)
const DEV_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY || '5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp'; // Test wallet private key
const STAY_TOKEN_MINT = process.env.STAY_TOKEN_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'; // DUMMY token from Credix faucet
// Initialize DEV wallet
function getDevWallet() {
    if (!DEV_WALLET_PRIVATE_KEY) {
        throw new Error('DEV wallet private key not configured');
    }
    return web3_js_1.Keypair.fromSecretKey(bs58_1.default.decode(DEV_WALLET_PRIVATE_KEY));
}
// 💰 MONITOR DEV WALLET FOR INCOMING PAYMENTS  
exports.monitorDevWallet = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
    var _a;
    console.log('🔍 Monitoring DEV wallet for game payments...');
    try {
        const devWallet = getDevWallet();
        const devPublicKey = devWallet.publicKey;
        // Get current SOL balance
        const currentBalance = await connection.getBalance(devPublicKey);
        const currentSol = currentBalance / web3_js_1.LAMPORTS_PER_SOL;
        console.log(`📊 DEV wallet balance: ${currentSol} SOL`);
        // Get last recorded balance from Firestore
        const balanceDoc = await db.collection('treasury').doc('balance').get();
        const lastBalance = balanceDoc.exists ? ((_a = balanceDoc.data()) === null || _a === void 0 ? void 0 : _a.solBalance) || 0 : 0;
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
    }
    catch (error) {
        console.error('Error monitoring DEV wallet:', error);
    }
});
// 🤖 AUTOMATIC TOKEN PURCHASE WITH GAME PAYMENTS
async function buyStayTokensWithPayments(solAmount) {
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
        const jupiterQuote = await axios_1.default.get('https://quote-api.jup.ag/v6/quote', {
            params: {
                inputMint: 'So11111111111111111111111111111111111111112', // SOL
                outputMint: STAY_TOKEN_MINT,
                amount: Math.floor(solToSpend * web3_js_1.LAMPORTS_PER_SOL),
                slippageBps: 300 // 3% slippage
            }
        });
        if (!jupiterQuote.data) {
            throw new Error('No quote from Jupiter');
        }
        // Get swap transaction
        const { data: swapTransaction } = await axios_1.default.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: jupiterQuote.data,
            userPublicKey: devWallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        });
        // Sign and send transaction
        const swapTransactionBuf = Buffer.from(swapTransaction.swapTransaction, 'base64');
        const transaction = web3_js_1.Transaction.from(swapTransactionBuf);
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
    }
    catch (error) {
        console.error('Error in automatic token purchase:', error);
    }
}
// 🎮 RECORD GAME PAYMENT (Called when player pays fee)
exports.recordGamePayment = functions.https.onCall(async (data, context) => {
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
    }
    catch (error) {
        console.error('Error recording game payment:', error);
        throw new functions.https.HttpsError('internal', 'Failed to record payment');
    }
});
// 🧪 SIMPLE TEST FUNCTION
exports.testFunction = functions.https.onCall(async (data, context) => {
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
    }
    catch (error) {
        console.error('Error in test function:', error);
        throw new functions.https.HttpsError('internal', 'Test function failed');
    }
});
// 📊 GET TREASURY STATUS
exports.getTreasuryStatus = functions.https.onCall(async (data, context) => {
    var _a;
    try {
        const devWallet = getDevWallet();
        const devPublicKey = devWallet.publicKey;
        // Get live SOL balance
        const solBalance = await connection.getBalance(devPublicKey);
        const solAmount = solBalance / web3_js_1.LAMPORTS_PER_SOL;
        // Get token balance from Firestore
        const tokenDoc = await db.collection('treasury').doc('tokens').get();
        const tokenBalance = tokenDoc.exists ? ((_a = tokenDoc.data()) === null || _a === void 0 ? void 0 : _a.stayTokenBalance) || 0 : 0;
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
    }
    catch (error) {
        console.error('Error getting treasury status:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get treasury status');
    }
});
// 🎯 DISTRIBUTE TOKENS TO PLAYERS (After game ends)
exports.distributeTokensToWinners = functions.https.onCall(async (data, context) => {
    try {
        const { gameId, winners, tokenAmountPerWinner, tokenMint } = data;
        console.log(`🏆 Starting token distribution for game ${gameId}`);
        console.log(`Winners: ${winners.length}, Amount each: ${tokenAmountPerWinner}, Token: ${tokenMint}`);
        const devWallet = getDevWallet();
        const tokenMintPubkey = new web3_js_1.PublicKey(tokenMint || STAY_TOKEN_MINT);
        // Get dev wallet's token account
        const devTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMintPubkey, devWallet.publicKey);
        const results = [];
        // Send tokens to each winner
        for (const winnerAddress of winners) {
            try {
                console.log(`💰 Sending ${tokenAmountPerWinner} DUMMY tokens to ${winnerAddress}`);
                const winnerPubkey = new web3_js_1.PublicKey(winnerAddress);
                // Get or create winner's token account
                const winnerTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMintPubkey, winnerPubkey);
                // Check if winner's token account exists
                const accountInfo = await connection.getAccountInfo(winnerTokenAccount);
                const transaction = new web3_js_1.Transaction();
                // Create token account if it doesn't exist
                if (!accountInfo) {
                    console.log(`📝 Creating token account for winner: ${winnerAddress}`);
                    const createAccountInstruction = (0, spl_token_1.createAssociatedTokenAccountInstruction)(devWallet.publicKey, // payer
                    winnerTokenAccount, // account to create
                    winnerPubkey, // owner
                    tokenMintPubkey // mint
                    );
                    transaction.add(createAccountInstruction);
                }
                // Add transfer instruction
                const transferInstruction = (0, spl_token_1.createTransferInstruction)(devTokenAccount, // source
                winnerTokenAccount, // destination  
                devWallet.publicKey, // owner
                tokenAmountPerWinner * Math.pow(10, 6), // amount (DUMMY tokens have 6 decimals)
                [], // signers
                spl_token_1.TOKEN_PROGRAM_ID);
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
            }
            catch (error) {
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
    }
    catch (error) {
        console.error('Error distributing tokens:', error);
        throw new functions.https.HttpsError('internal', 'Failed to distribute tokens');
    }
});
// 🔧 MANUAL TOKEN PURCHASE (For testing/manual triggers)
exports.buyTokensManually = functions.https.onCall(async (data, context) => {
    try {
        const { solAmount } = data;
        await buyStayTokensWithPayments(solAmount);
        return { success: true, message: 'Manual token purchase initiated' };
    }
    catch (error) {
        console.error('Error in manual purchase:', error);
        throw new functions.https.HttpsError('internal', 'Manual purchase failed');
    }
});
//# sourceMappingURL=index.js.map