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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugConfig = exports.gameFunction = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const bs58 = __importStar(require("bs58"));
const axios_1 = __importDefault(require("axios"));
admin.initializeApp();
const db = admin.firestore();
// Jupiter V6 API Configuration
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
// Helper function to format token amounts with decimals
function formatTokenAmount(rawAmount, decimals = 9) {
    const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
    const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
    });
    return formatted;
}
// Helper function to detect if token uses Token2022 program
async function getTokenProgramId(connection, tokenMint) {
    try {
        const mintInfo = await connection.getAccountInfo(new web3_js_1.PublicKey(tokenMint));
        if (mintInfo === null || mintInfo === void 0 ? void 0 : mintInfo.owner.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)) {
            console.log('🔍 Detected Token2022 program for BALL token');
            return spl_token_1.TOKEN_2022_PROGRAM_ID;
        }
        else {
            console.log('🔍 Detected legacy SPL Token program for BALL token');
            return spl_token_1.TOKEN_PROGRAM_ID;
        }
    }
    catch (error) {
        console.log('⚠️ Could not detect token program, defaulting to SPL Token');
        return spl_token_1.TOKEN_PROGRAM_ID;
    }
}
// Helper function to get configuration from Firestore
async function getGameConfig() {
    var _a, _b, _c;
    try {
        const configDoc = await db.collection('config').doc('game').get();
        const configData = configDoc.exists ? configDoc.data() : {};
        // Get treasury private key from Firebase Functions config
        const privateKey = (_a = functions.config().treasury) === null || _a === void 0 ? void 0 : _a.pk;
        if (!privateKey) {
            throw new Error('Treasury private key not configured');
        }
        // Get BALL token mint
        const ballTokenDoc = await db.collection('tokenID').doc('BALL').get();
        const ballToken = ballTokenDoc.exists ? ballTokenDoc.data() : {};
        // Use tokenMint from config/game, or fall back to BALL token mintAddress
        const tokenMint = (configData === null || configData === void 0 ? void 0 : configData.tokenMint) || (ballToken === null || ballToken === void 0 ? void 0 : ballToken.mintAddress);
        if (!tokenMint) {
            console.log('⚠️ Token mint not found in Firestore, using default BALL token');
        }
        // Default configuration with Firestore overrides
        const config = {
            network: (configData === null || configData === void 0 ? void 0 : configData.network) || 'mainnet',
            rpcUrl: (configData === null || configData === void 0 ? void 0 : configData.rpcUrl) || 'https://api.mainnet-beta.solana.com',
            treasuryWallet: privateKey,
            tokenMint: tokenMint || 'BALLrveijbhu42QaS2XW1pRBYfMji73bGeYJghUvQs6y',
            entryFee: (configData === null || configData === void 0 ? void 0 : configData.entryFee) || 0.01,
            maxPlayersPerGame: (configData === null || configData === void 0 ? void 0 : configData.maxPlayersPerGame) || 1,
            autoStartNewGames: (_b = configData === null || configData === void 0 ? void 0 : configData.autoStartNewGames) !== null && _b !== void 0 ? _b : true,
            isProduction: (_c = configData === null || configData === void 0 ? void 0 : configData.isProduction) !== null && _c !== void 0 ? _c : false
        };
        console.log('✅ Game configuration loaded:', {
            network: config.network,
            rpcUrl: config.rpcUrl ? 'SET' : 'NOT SET',
            tokenMint: config.tokenMint ? 'SET' : 'NOT SET',
            entryFee: config.entryFee
        });
        return config;
    }
    catch (error) {
        console.error('❌ Error getting game config:', error);
        throw error;
    }
}
// Helper function to perform Jupiter swap
async function performJupiterSwap(connection, treasuryWallet, solAmount, tokenMint) {
    var _a, _b, _c, _d;
    try {
        console.log(`🔄 Starting Jupiter swap: ${solAmount} SOL → BALL tokens`);
        console.log(`📊 Using token mint: ${tokenMint}`);
        // Convert SOL amount to lamports
        const amountInLamports = Math.floor(solAmount * web3_js_1.LAMPORTS_PER_SOL);
        console.log(`💰 Amount to swap: ${amountInLamports} lamports (${solAmount} SOL)`);
        // Step 1: Get quote from Jupiter API
        const quoteParams = new URLSearchParams({
            inputMint: SOL_MINT,
            outputMint: tokenMint,
            amount: amountInLamports.toString(),
            slippageBps: '300', // 3% slippage tolerance
            swapMode: 'ExactIn',
            maxAccounts: '64'
        });
        console.log(`🔍 Getting Jupiter quote...`);
        const quoteUrl = `${JUPITER_API_URL}/quote?${quoteParams}`;
        console.log(`📡 Quote URL: ${quoteUrl}`);
        const quoteResponse = await axios_1.default.get(quoteUrl, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        if (!quoteResponse.data) {
            throw new Error('No quote received from Jupiter');
        }
        const quote = quoteResponse.data;
        console.log(`✅ Jupiter quote received:`, {
            inputAmount: quote.inAmount,
            outputAmount: quote.outAmount,
            priceImpactPct: quote.priceImpactPct,
            route: ((_a = quote.routePlan) === null || _a === void 0 ? void 0 : _a.length) || 0 + ' steps'
        });
        // Step 2: Get swap transaction from Jupiter
        console.log(`🏗️ Getting swap transaction from Jupiter...`);
        console.log(`🎯 Let Jupiter auto-detect Token2022 and handle all account creation`);
        const swapResponse = await axios_1.default.post(`${JUPITER_API_URL}/swap`, {
            quoteResponse: quote,
            userPublicKey: treasuryWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: { maxBps: 500 }, // Allow up to 5% slippage for better success rate
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 10000000,
                    priorityLevel: "high"
                }
            }
        }, {
            timeout: 15000, // Increase timeout
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        if (!((_b = swapResponse.data) === null || _b === void 0 ? void 0 : _b.swapTransaction)) {
            throw new Error('No swap transaction received from Jupiter');
        }
        // Step 3: Deserialize and sign transaction
        console.log(`✍️ Signing swap transaction...`);
        const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = web3_js_1.VersionedTransaction.deserialize(swapTransactionBuf);
        // Sign the transaction
        transaction.sign([treasuryWallet]);
        // Step 4: Send transaction
        console.log(`📤 Sending swap transaction to Solana...`);
        const latestBlockHash = await connection.getLatestBlockhash();
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });
        // Confirm transaction
        console.log(`⏳ Confirming transaction: ${signature}`);
        await connection.confirmTransaction({
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: signature
        });
        console.log(`🎉 Jupiter swap completed successfully!`);
        console.log(`📝 Transaction: https://solscan.io/tx/${signature}`);
        console.log(`💰 Swapped ${solAmount} SOL for ${quote.outAmount} BALL tokens`);
        return {
            success: true,
            signature,
            inputAmount: quote.inAmount,
            outputAmount: quote.outAmount,
            priceImpactPct: quote.priceImpactPct
        };
    }
    catch (error) {
        console.error('❌ Jupiter swap failed:', (error === null || error === void 0 ? void 0 : error.message) || error);
        // Log more details for debugging
        if ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) {
            console.error('🔍 Jupiter API error details:', error.response.data);
        }
        return {
            success: false,
            error: (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error during Jupiter swap',
            details: ((_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) || null
        };
    }
}
// ensureTreasuryTokenAccount function removed - Jupiter handles all account creation automatically
// Helper function to distribute tokens to winner
async function distributeTokens(connection, treasuryWallet, winnerAddress, tokenMintAddress, amount) {
    try {
        const formattedAmount = formatTokenAmount(amount);
        console.log(`🏆 Distributing ${formattedAmount} BALL tokens (${amount} raw) to winner: ${winnerAddress}`);
        const tokenMintPubkey = new web3_js_1.PublicKey(tokenMintAddress);
        const winnerPubkey = new web3_js_1.PublicKey(winnerAddress);
        // Detect the correct token program
        const tokenProgramId = await getTokenProgramId(connection, tokenMintAddress);
        // Get associated token accounts with correct program
        const treasuryTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMintPubkey, treasuryWallet.publicKey, false, tokenProgramId);
        const winnerTokenAccount = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMintPubkey, winnerPubkey, false, tokenProgramId);
        const instructions = [];
        // Check if winner token account exists, create if needed
        const winnerAccountInfo = await connection.getAccountInfo(winnerTokenAccount);
        if (!winnerAccountInfo) {
            console.log('📝 Creating winner token account...');
            instructions.push((0, spl_token_1.createAssociatedTokenAccountInstruction)(treasuryWallet.publicKey, // payer
            winnerTokenAccount, // ata
            winnerPubkey, // owner
            tokenMintPubkey, // mint
            tokenProgramId // programId
            ));
        }
        // Add transfer instruction - use transferChecked for Token2022
        if (tokenProgramId.equals(spl_token_1.TOKEN_2022_PROGRAM_ID)) {
            console.log('🔄 Using transferChecked for Token2022');
            instructions.push((0, spl_token_1.createTransferCheckedInstruction)(treasuryTokenAccount, // from
            tokenMintPubkey, // mint
            winnerTokenAccount, // to
            treasuryWallet.publicKey, // owner
            amount, // amount
            9, // decimals (BALL token has 9 decimals)
            [], // multiSigners
            tokenProgramId // programId
            ));
        }
        else {
            console.log('🔄 Using regular transfer for legacy SPL token');
            instructions.push((0, spl_token_1.createTransferInstruction)(treasuryTokenAccount, // from
            winnerTokenAccount, // to
            treasuryWallet.publicKey, // owner
            amount, // amount
            [], // multiSigners
            tokenProgramId // programId
            ));
        }
        // Send transaction
        const transaction = new web3_js_1.Transaction().add(...instructions);
        const signature = await connection.sendTransaction(transaction, [treasuryWallet]);
        await connection.confirmTransaction(signature);
        console.log(`🎉 Token distribution completed! Transaction: ${signature}`);
        return {
            success: true,
            signature,
            amount
        };
    }
    catch (error) {
        console.error('❌ Token distribution failed:', error);
        return {
            success: false,
            error: (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error during token distribution'
        };
    }
}
// Main game function
exports.gameFunction = functions.https.onCall(async (data, context) => {
    try {
        const { action, gameId, playerAddress, transactionSignature } = data, params = __rest(data, ["action", "gameId", "playerAddress", "transactionSignature"]);
        const config = await getGameConfig();
        const connection = new web3_js_1.Connection(config.rpcUrl, 'confirmed');
        const treasuryWallet = web3_js_1.Keypair.fromSecretKey(bs58.decode(config.treasuryWallet));
        console.log(`🎮 Game function called: ${action}`);
        switch (action) {
            case 'getConfig':
                return {
                    success: true,
                    config: {
                        network: config.network,
                        rpcUrl: config.rpcUrl,
                        treasuryAddress: treasuryWallet.publicKey.toString(),
                        tokenSymbol: 'BALL',
                        entryFee: config.entryFee,
                        maxPlayersPerGame: config.maxPlayersPerGame,
                        autoStartNewGames: config.autoStartNewGames,
                        isProduction: config.isProduction
                    }
                };
            case 'recordPayment':
                try {
                    console.log(`💰 Recording payment for game: ${gameId}`);
                    // Record payment in Firestore
                    const paymentData = {
                        gameId,
                        playerAddress,
                        transactionSignature,
                        amount: config.entryFee,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        status: 'confirmed'
                    };
                    // Add to payments collection
                    await db.collection('payments').add(paymentData);
                    // Update game with payment info
                    await db.collection('games').doc(gameId).set({
                        players: admin.firestore.FieldValue.arrayUnion(playerAddress),
                        totalSolCollected: admin.firestore.FieldValue.increment(config.entryFee),
                        payments: admin.firestore.FieldValue.arrayUnion({
                            player: playerAddress,
                            signature: transactionSignature,
                            amount: config.entryFee
                        }),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    console.log(`✅ Payment recorded successfully for ${playerAddress}`);
                    return {
                        success: true,
                        message: 'Payment recorded successfully'
                    };
                }
                catch (error) {
                    console.error('❌ Error recording payment:', error);
                    return {
                        success: false,
                        error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to record payment'
                    };
                }
            case 'startGame':
                try {
                    console.log(`🎯 Starting new game and performing Jupiter swap...`);
                    // Let Jupiter handle ALL account creation automatically
                    console.log('🚀 Letting Jupiter handle all Token2022 account creation automatically');
                    // Get current accumulated SOL to swap
                    const gameDoc = await db.collection('games').doc(gameId).get();
                    const gameData = gameDoc.exists ? gameDoc.data() : { totalSolCollected: 0 };
                    const solToSwap = (gameData === null || gameData === void 0 ? void 0 : gameData.totalSolCollected) || config.entryFee;
                    if (solToSwap > 0) {
                        console.log(`💰 Found ${solToSwap} SOL to swap for BALL tokens`);
                        // Perform Jupiter swap
                        const swapResult = await performJupiterSwap(connection, treasuryWallet, solToSwap, config.tokenMint);
                        if (swapResult.success) {
                            const formattedAmount = formatTokenAmount(swapResult.outputAmount || '0');
                            console.log(`🎉 Jupiter swap completed successfully!`);
                            console.log(`💰 Swapped ${solToSwap} SOL for ${formattedAmount} BALL tokens (${swapResult.outputAmount} raw)`);
                            console.log(`📝 Transaction: https://solscan.io/tx/${swapResult.signature}`);
                            // Update game with swap details
                            await db.collection('games').doc(gameId).update({
                                jupiterSwap: {
                                    signature: swapResult.signature,
                                    inputAmount: swapResult.inputAmount,
                                    outputAmount: swapResult.outputAmount,
                                    priceImpact: swapResult.priceImpactPct,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                                },
                                totalSolCollected: 0, // Reset after swap
                                ballTokensAvailable: parseInt(swapResult.outputAmount || '0')
                            });
                            return {
                                success: true,
                                message: `Game started and ${solToSwap} SOL swapped for ${formattedAmount} BALL tokens`,
                                swapSignature: swapResult.signature,
                                ballTokensAvailable: parseInt(swapResult.outputAmount || '0'),
                                ballTokensFormatted: formattedAmount,
                                swapCompleted: true
                            };
                        }
                        else {
                            // Don't fail the entire game if swap fails, just log it
                            console.log(`⚠️ Jupiter swap failed but game continues: ${swapResult.error}`);
                            // Update game to show swap failed but game is active
                            await db.collection('games').doc(gameId).update({
                                swapFailed: {
                                    error: swapResult.error,
                                    details: swapResult.details,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                                },
                                ballTokensAvailable: 0 // No tokens available since swap failed
                            });
                            return {
                                success: true,
                                message: `Game started but Jupiter swap failed: ${swapResult.error}`,
                                swapFailed: true,
                                swapCompleted: false,
                                ballTokensAvailable: 0,
                                details: swapResult.details
                            };
                        }
                    }
                    else {
                        return {
                            success: true,
                            message: 'Game started but no new SOL to convert',
                            swapCompleted: false,
                            ballTokensAvailable: 0
                        };
                    }
                }
                catch (error) {
                    console.error('❌ Error starting game:', error);
                    return {
                        success: false,
                        error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to start game'
                    };
                }
            case 'distributeTokens':
                try {
                    const { winnerAddress, amount } = params;
                    if (!winnerAddress) {
                        throw new Error('Winner address is required');
                    }
                    // If amount not provided, get from game data or use default
                    let tokenAmount = amount;
                    if (!tokenAmount) {
                        const gameDoc = await db.collection('games').doc(gameId).get();
                        const gameData = gameDoc.exists ? gameDoc.data() : {};
                        tokenAmount = (gameData === null || gameData === void 0 ? void 0 : gameData.ballTokensAvailable) || 1000000; // Default 1M tokens
                        const formattedDefault = formatTokenAmount(tokenAmount);
                        console.log(`💰 Using default token amount: ${formattedDefault} BALL tokens (${tokenAmount} raw)`);
                    }
                    const result = await distributeTokens(connection, treasuryWallet, winnerAddress, config.tokenMint, tokenAmount);
                    return result;
                }
                catch (error) {
                    console.error('❌ Error distributing tokens:', error);
                    return {
                        success: false,
                        error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to distribute tokens'
                    };
                }
            default:
                return {
                    success: false,
                    error: `Unknown action: ${action}`
                };
        }
    }
    catch (error) {
        console.error('❌ Game function error:', error);
        return {
            success: false,
            error: (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error'
        };
    }
});
// Debug function to check configuration status
exports.debugConfig = functions.https.onCall(async (data, context) => {
    var _a;
    try {
        console.log('🔍 Debug: Checking configuration status...');
        // Get config from Firestore
        const configDoc = await db.collection('config').doc('game').get();
        const configData = configDoc.exists ? configDoc.data() : null;
        // Get BALL token info
        const ballTokenDoc = await db.collection('tokenID').doc('BALL').get();
        const ballTokenData = ballTokenDoc.exists ? ballTokenDoc.data() : null;
        // Get treasury info
        const treasuryDoc = await db.collection('config').doc('treasury').get();
        const treasuryData = treasuryDoc.exists ? treasuryDoc.data() : null;
        // Check Firebase Functions config
        const hasPrivateKey = !!((_a = functions.config().treasury) === null || _a === void 0 ? void 0 : _a.pk);
        const status = {
            firebaseConfig: {
                exists: configDoc.exists,
                data: configData,
                rpcUrl: (configData === null || configData === void 0 ? void 0 : configData.rpcUrl) || 'NOT SET',
                tokenMint: (configData === null || configData === void 0 ? void 0 : configData.tokenMint) || 'NOT SET'
            },
            ballToken: {
                exists: ballTokenDoc.exists,
                data: ballTokenData,
                mintAddress: (ballTokenData === null || ballTokenData === void 0 ? void 0 : ballTokenData.mintAddress) || 'NOT SET'
            },
            treasury: {
                configExists: treasuryDoc.exists,
                data: treasuryData,
                hasPrivateKey: hasPrivateKey
            },
            recommendations: []
        };
        // Add recommendations
        if (!(configData === null || configData === void 0 ? void 0 : configData.rpcUrl)) {
            status.recommendations.push('Add rpcUrl to config/game document');
        }
        if (!(configData === null || configData === void 0 ? void 0 : configData.tokenMint) && !(ballTokenData === null || ballTokenData === void 0 ? void 0 : ballTokenData.mintAddress)) {
            status.recommendations.push('Add tokenMint to config/game or mintAddress to tokenID/BALL');
        }
        if (!hasPrivateKey) {
            status.recommendations.push('Configure treasury private key in Firebase Functions config');
        }
        return {
            success: true,
            status
        };
    }
    catch (error) {
        console.error('❌ Debug config error:', error);
        return {
            success: false,
            error: (error === null || error === void 0 ? void 0 : error.message) || 'Unknown error'
        };
    }
});
//# sourceMappingURL=index.js.map