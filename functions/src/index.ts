import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Connection, PublicKey, Keypair, Transaction, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, createTransferCheckedInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as bs58 from 'bs58';
import axios from 'axios';

admin.initializeApp();
const db = admin.firestore();

// Jupiter V6 API Configuration
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Helper function to format token amounts with decimals
function formatTokenAmount(rawAmount: string | number, decimals: number = 9): string {
  const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
  return formatted;
}

// Helper function to detect if token uses Token2022 program
async function getTokenProgramId(connection: Connection, tokenMint: string): Promise<PublicKey> {
  try {
    const mintInfo = await connection.getAccountInfo(new PublicKey(tokenMint));
    if (mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      console.log('🔍 Detected Token2022 program for BALL token');
      return TOKEN_2022_PROGRAM_ID;
    } else {
      console.log('🔍 Detected legacy SPL Token program for BALL token');
      return TOKEN_PROGRAM_ID;
    }
  } catch (error) {
    console.log('⚠️ Could not detect token program, defaulting to SPL Token');
    return TOKEN_PROGRAM_ID;
  }
}

// Helper function to get configuration from Firestore
async function getGameConfig() {
  try {
    const configDoc = await db.collection('config').doc('game').get();
    const configData = configDoc.exists ? configDoc.data() : {};
    
    // Get treasury private key from Firebase Functions config
    const privateKey = functions.config().treasury?.pk;
    if (!privateKey) {
      throw new Error('Treasury private key not configured');
    }
    
    // Get BALL token mint
    const ballTokenDoc = await db.collection('tokenID').doc('BALL').get();
    const ballToken = ballTokenDoc.exists ? ballTokenDoc.data() : {};
    
    // Use tokenMint from config/game, or fall back to BALL token mintAddress
    const tokenMint = configData?.tokenMint || ballToken?.mintAddress;
    
    if (!tokenMint) {
      console.log('⚠️ Token mint not found in Firestore, using default BALL token');
    }
    
    // Default configuration with Firestore overrides
    const config = {
      network: configData?.network || 'mainnet',
      rpcUrl: configData?.rpcUrl || 'https://api.mainnet-beta.solana.com',
      treasuryWallet: privateKey,
      tokenMint: tokenMint || 'BALLrveijbhu42QaS2XW1pRBYfMji73bGeYJghUvQs6y',
      entryFee: configData?.entryFee || 0.01,
      maxPlayersPerGame: configData?.maxPlayersPerGame || 1,
      autoStartNewGames: configData?.autoStartNewGames ?? true,
      isProduction: configData?.isProduction ?? false
    };
    
    console.log('✅ Game configuration loaded:', {
      network: config.network,
      rpcUrl: config.rpcUrl ? 'SET' : 'NOT SET',
      tokenMint: config.tokenMint ? 'SET' : 'NOT SET',
      entryFee: config.entryFee
    });
    
    return config;
  } catch (error) {
    console.error('❌ Error getting game config:', error);
    throw error;
  }
}

// Helper function to perform Jupiter swap
async function performJupiterSwap(connection: Connection, treasuryWallet: Keypair, solAmount: number, tokenMint: string) {
  try {
    console.log(`🔄 Starting Jupiter swap: ${solAmount} SOL → BALL tokens`);
    console.log(`📊 Using token mint: ${tokenMint}`);
    
    // Convert SOL amount to lamports
    const amountInLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
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
    
    const quoteResponse = await axios.get(quoteUrl, {
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
      route: quote.routePlan?.length || 0 + ' steps'
    });
    
    // Step 2: Get swap transaction from Jupiter
    console.log(`🏗️ Getting swap transaction from Jupiter...`);
    console.log(`🎯 Let Jupiter auto-detect Token2022 and handle all account creation`);
    
    const swapResponse = await axios.post(`${JUPITER_API_URL}/swap`, {
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
    
    if (!swapResponse.data?.swapTransaction) {
      throw new Error('No swap transaction received from Jupiter');
    }
    
    // Step 3: Deserialize and sign transaction
    console.log(`✍️ Signing swap transaction...`);
    const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    
    // Sign the transaction
    transaction.sign([treasuryWallet]);
    
    // Step 4: Send transaction
    console.log(`📤 Sending swap transaction to Solana...`);
    const latestBlockHash = await connection.getLatestBlockhash();
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: true,
        maxRetries: 3
      }
    );
    
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
    
  } catch (error: any) {
    console.error('❌ Jupiter swap failed:', error?.message || error);
    
    // Log more details for debugging
    if (error?.response?.data) {
      console.error('🔍 Jupiter API error details:', error.response.data);
    }
    
    return {
      success: false,
      error: error?.message || 'Unknown error during Jupiter swap',
      details: error?.response?.data || null
    };
  }
}

// ensureTreasuryTokenAccount function removed - Jupiter handles all account creation automatically

// Helper function to distribute tokens to winner
async function distributeTokens(connection: Connection, treasuryWallet: Keypair, winnerAddress: string, tokenMintAddress: string, amount: number) {
  try {
    const formattedAmount = formatTokenAmount(amount);
    console.log(`🏆 Distributing ${formattedAmount} BALL tokens (${amount} raw) to winner: ${winnerAddress}`);
    
    const tokenMintPubkey = new PublicKey(tokenMintAddress);
    const winnerPubkey = new PublicKey(winnerAddress);
    
    // Detect the correct token program
    const tokenProgramId = await getTokenProgramId(connection, tokenMintAddress);
    
    // Get associated token accounts with correct program
    const treasuryTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey, 
      treasuryWallet.publicKey,
      false,
      tokenProgramId
    );
    const winnerTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey, 
      winnerPubkey,
      false,
      tokenProgramId
    );
    
    const instructions = [];
    
    // Check if winner token account exists, create if needed
    const winnerAccountInfo = await connection.getAccountInfo(winnerTokenAccount);
    if (!winnerAccountInfo) {
      console.log('📝 Creating winner token account...');
      instructions.push(
        createAssociatedTokenAccountInstruction(
          treasuryWallet.publicKey, // payer
          winnerTokenAccount, // ata
          winnerPubkey, // owner
          tokenMintPubkey, // mint
          tokenProgramId // programId
        )
      );
    }
    
    // Add transfer instruction - use transferChecked for Token2022
    if (tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)) {
      console.log('🔄 Using transferChecked for Token2022');
      instructions.push(
        createTransferCheckedInstruction(
          treasuryTokenAccount, // from
          tokenMintPubkey, // mint
          winnerTokenAccount, // to
          treasuryWallet.publicKey, // owner
          amount, // amount
          9, // decimals (BALL token has 9 decimals)
          [], // multiSigners
          tokenProgramId // programId
        )
      );
    } else {
      console.log('🔄 Using regular transfer for legacy SPL token');
      instructions.push(
        createTransferInstruction(
          treasuryTokenAccount, // from
          winnerTokenAccount, // to
          treasuryWallet.publicKey, // owner
          amount, // amount
          [], // multiSigners
          tokenProgramId // programId
        )
      );
    }
    
    // Send transaction
    const transaction = new Transaction().add(...instructions);
    const signature = await connection.sendTransaction(transaction, [treasuryWallet]);
    await connection.confirmTransaction(signature);
    
    console.log(`🎉 Token distribution completed! Transaction: ${signature}`);
    return {
      success: true,
      signature,
      amount
    };
    
  } catch (error: any) {
    console.error('❌ Token distribution failed:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error during token distribution'
    };
  }
}

// Main game function
export const gameFunction = functions.https.onCall(async (data, context) => {
  try {
    const { action, gameId, playerAddress, transactionSignature, ...params } = data;
    
    const config = await getGameConfig();
    const connection = new Connection(config.rpcUrl, 'confirmed');
    const treasuryWallet = Keypair.fromSecretKey(bs58.decode(config.treasuryWallet));
    
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
          
        } catch (error: any) {
          console.error('❌ Error recording payment:', error);
          return {
            success: false,
            error: error?.message || 'Failed to record payment'
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
          const solToSwap = gameData?.totalSolCollected || config.entryFee;
          
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
            } else {
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
          } else {
            return {
              success: true,
              message: 'Game started but no new SOL to convert',
              swapCompleted: false,
              ballTokensAvailable: 0
            };
          }
        } catch (error: any) {
          console.error('❌ Error starting game:', error);
          return {
            success: false,
            error: error?.message || 'Failed to start game'
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
            tokenAmount = gameData?.ballTokensAvailable || 1000000; // Default 1M tokens
            const formattedDefault = formatTokenAmount(tokenAmount);
            console.log(`💰 Using default token amount: ${formattedDefault} BALL tokens (${tokenAmount} raw)`);
          }
          
          const result = await distributeTokens(connection, treasuryWallet, winnerAddress, config.tokenMint, tokenAmount);
          return result;
          
        } catch (error: any) {
          console.error('❌ Error distributing tokens:', error);
          return {
            success: false,
            error: error?.message || 'Failed to distribute tokens'
          };
        }
        
      default:
        return {
          success: false,
          error: `Unknown action: ${action}`
        };
    }
    
  } catch (error: any) {
    console.error('❌ Game function error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
});

// Debug function to check configuration status
export const debugConfig = functions.https.onCall(async (data, context) => {
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
    const hasPrivateKey = !!functions.config().treasury?.pk;
    
    const status = {
      firebaseConfig: {
        exists: configDoc.exists,
        data: configData,
        rpcUrl: configData?.rpcUrl || 'NOT SET',
        tokenMint: configData?.tokenMint || 'NOT SET'
      },
      ballToken: {
        exists: ballTokenDoc.exists,
        data: ballTokenData,
        mintAddress: ballTokenData?.mintAddress || 'NOT SET'
      },
      treasury: {
        configExists: treasuryDoc.exists,
        data: treasuryData,
        hasPrivateKey: hasPrivateKey
      },
      recommendations: [] as string[]
    };
    
    // Add recommendations
    if (!configData?.rpcUrl) {
      status.recommendations.push('Add rpcUrl to config/game document');
    }
    if (!configData?.tokenMint && !ballTokenData?.mintAddress) {
      status.recommendations.push('Add tokenMint to config/game or mintAddress to tokenID/BALL');
    }
    if (!hasPrivateKey) {
      status.recommendations.push('Configure treasury private key in Firebase Functions config');
    }
    
    return {
      success: true,
      status
    };
    
  } catch (error: any) {
    console.error('❌ Debug config error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
});