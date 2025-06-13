const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { 
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction,
    LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const { 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    createTransferInstruction,
    createTransferCheckedInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID
} = require('@solana/spl-token');
// Handle bs58 import for different module systems
let bs58;
try {
    bs58 = require('bs58');
    // Test if decode function exists
    if (typeof bs58.decode !== 'function') {
        // Try default export
        bs58 = bs58.default || bs58;
    }
} catch (error) {
    console.error('Failed to import bs58:', error);
    throw new Error('bs58 module not available');
}
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Game configuration
async function getGameConfig() {
    const configDoc = await db.collection('config').doc('game').get();
    if (!configDoc.exists) throw new Error('Game configuration not found');
    const configData = configDoc.data() || {};
    
    // Try to get private key from functions config first, then environment variable
    let privateKey;
    try {
        privateKey = functions.config().treasury?.pk;
    } catch (error) {
        console.log('Functions config not available, trying environment variable');
    }
    
    if (!privateKey) {
        privateKey = process.env.TREASURY_PK;
    }
    
    if (!privateKey) {
        throw new Error('Treasury private key not configured. Please set up the private key securely.');
    }

    let treasuryWallet;
    try {
        console.log('bs58 type:', typeof bs58);
        console.log('bs58.decode type:', typeof bs58.decode);
        
        if (typeof bs58.decode !== 'function') {
            throw new Error('bs58.decode is not a function. bs58 module may not be properly loaded.');
        }
        
        const secretKeyBytes = bs58.decode(privateKey);
        treasuryWallet = Keypair.fromSecretKey(secretKeyBytes);
        console.log('Treasury wallet created successfully');
    } catch (error) {
        console.error('Error creating treasury wallet:', error);
        throw new Error('Invalid treasury private key format: ' + error.message);
    }

    return {
        network: configData.network || 'mainnet',
        rpcUrl: configData.rpcUrl || 'https://api.mainnet-beta.solana.com',
        treasuryWallet: treasuryWallet,
        ballTokenMint: configData.prizeTokenMintAddress || 'BALLrveijbhu42QaS2XW1pRBYfMji73bGeYJghUvQs6y',
        entryFeeSol: configData.entryFee || 0.01,
        maxPlayers: configData.maxPlayersPerGame || 5,
        npcInGame: configData.npcInGame ?? true,
        roundDurationSec: configData.roundDurationSec || 5,
        isProduction: configData.isProduction ?? false,
        tokenSymbol: configData.tokenSymbol || 'BALL',
        prizeTokenDecimals: configData.prizeTokenDecimals || 9
    };
}

// Join Lobby with SOL Payment Verification
exports.joinLobby = functions.https.onCall(async (data, context) => {
    const { playerAddress, transactionSignature } = data;
    
    if (!playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Player address and transaction signature required');
    }

    try {
        const config = await getGameConfig();
        console.log(`🎮 Player ${playerAddress} attempting to join lobby`);

        const connection = new Connection(config.rpcUrl, 'confirmed');
        
        // If transaction signature provided, verify the payment
        if (transactionSignature) {
            console.log(`💰 Verifying payment transaction: ${transactionSignature}`);
            
            try {
                // Get transaction details
                const transaction = await connection.getTransaction(transactionSignature, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0
                });
                
                if (!transaction) {
                    throw new functions.https.HttpsError('invalid-argument', 'Transaction not found or not confirmed');
                }
                
                // Verify transaction success
                if (transaction.meta?.err) {
                    throw new functions.https.HttpsError('invalid-argument', 'Transaction failed');
                }
                
                // Verify payment amount and recipient
                const expectedLamports = Math.floor(config.entryFeeSol * LAMPORTS_PER_SOL);
                let paymentVerified = false;
                
                // Check pre and post balances for treasury wallet
                const treasuryPubkey = config.treasuryWallet.publicKey;
                const accountKeys = transaction.transaction.message.staticAccountKeys || 
                                 transaction.transaction.message.accountKeys;
                
                const treasuryIndex = accountKeys.findIndex(key => key.equals(treasuryPubkey));
                
                if (treasuryIndex !== -1 && transaction.meta?.preBalances && transaction.meta?.postBalances) {
                    const balanceChange = transaction.meta.postBalances[treasuryIndex] - transaction.meta.preBalances[treasuryIndex];
                    
                    if (balanceChange >= expectedLamports * 0.95) { // Allow 5% tolerance for fees
                        paymentVerified = true;
                        console.log(`✅ Payment verified: ${balanceChange} lamports received`);
                    }
                }
                
                if (!paymentVerified) {
                    throw new functions.https.HttpsError('invalid-argument', 'Payment amount or recipient verification failed');
                }
                
            } catch (error) {
                console.error('Payment verification failed:', error);
                throw new functions.https.HttpsError('invalid-argument', 'Payment verification failed: ' + error.message);
            }
        } else {
            // No transaction signature - just check balance for UI purposes
            const playerPubkey = new PublicKey(playerAddress);
            const balance = await connection.getBalance(playerPubkey);
            const solBalance = balance / LAMPORTS_PER_SOL;

            if (solBalance < config.entryFeeSol) {
                throw new functions.https.HttpsError('failed-precondition', 
                    `Insufficient SOL balance. Need ${config.entryFeeSol} SOL, have ${solBalance.toFixed(4)} SOL`);
            }
            
            // Return payment instruction for frontend
            return {
                success: false,
                requiresPayment: true,
                entryFee: config.entryFeeSol,
                treasuryAddress: config.treasuryWallet.publicKey.toString(),
                message: `Please send ${config.entryFeeSol} SOL to join the game`
            };
        }

        // Record payment in Firestore
        const paymentData = {
            playerAddress,
            transactionSignature,
            amount: config.entryFeeSol,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'confirmed'
        };
        
        await db.collection('payments').add(paymentData);

        // Find or create a lobby
        const existingLobbyQuery = db.collection('games')
            .where('status', '==', 'lobby')
            .where('isProduction', '==', config.isProduction)
            .limit(1);
        
        const existingLobbies = await existingLobbyQuery.get();
        
        let gameRef;
        let gameData;
        
        if (!existingLobbies.empty) {
            gameRef = existingLobbies.docs[0].ref;
            gameData = existingLobbies.docs[0].data();
            console.log(`🔗 Joining existing lobby: ${gameRef.id}`);
        } else {
            // Create new lobby
            gameRef = db.collection('games').doc();
            gameData = {
                status: 'lobby',
                players: {},
                playerCount: 0,
                round: 0,
                roundStartedAt: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                isProduction: config.isProduction,
                totalSolCollected: 0,
                entryFeeSol: config.entryFeeSol,
                ballTokenMint: config.ballTokenMint,
                tokenSymbol: config.tokenSymbol,
                payments: []
            };
            console.log(`🆕 Creating new lobby: ${gameRef.id}`);
        }

        let players = gameData?.players || {};

        // Add the player
        if (!players[playerAddress]) {
            players[playerAddress] = {
                address: playerAddress,
                name: `Player ${playerAddress.slice(0, 4)}`,
                status: 'alive',
                isNpc: false,
                lastActionRound: 0,
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                solPaid: config.entryFeeSol,
                transactionSignature: transactionSignature
            };
            console.log(`✅ Added player ${playerAddress} to lobby`);
        }

        // Add bots if enabled and needed
        if (config.npcInGame) {
            const currentPlayerCount = Object.keys(players).length;
            const botsNeeded = config.maxPlayers - currentPlayerCount;
            
            console.log(`🤖 Adding ${botsNeeded} bots (npcInGame: ${config.npcInGame}, maxPlayers: ${config.maxPlayers})`);
            
            for (let i = 1; i <= botsNeeded; i++) {
                const botId = `BOT_${i}_${Date.now()}`;
                players[botId] = {
                    address: botId,
                    name: `Bot ${i}`,
                    status: 'alive',
                    isNpc: true,
                    lastActionRound: 0,
                    eliminationRound: i, // Bot 1 dies round 1, Bot 2 dies round 2, etc.
                    solPaid: 0 // Bots don't pay
                };
            }
        } else {
            console.log(`🚫 No bots added (npcInGame: false)`);
        }

        const finalPlayerCount = Object.keys(players).length;

        // Update game data
        const updateData = {
            players: players,
            playerCount: finalPlayerCount,
            totalSolCollected: admin.firestore.FieldValue.increment(config.entryFeeSol),
            payments: admin.firestore.FieldValue.arrayUnion({
                player: playerAddress,
                signature: transactionSignature,
                amount: config.entryFeeSol
            }),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Start game when we reach max players OR when NPCs are disabled and we have at least 1 player
        const shouldStartGame = config.npcInGame ? 
            (finalPlayerCount >= config.maxPlayers) : 
            (finalPlayerCount >= 1); // Start immediately if no NPCs
            
        if (shouldStartGame) {
            console.log(`🚀 GAME START: ${finalPlayerCount} players (maxPlayers: ${config.maxPlayers}, npcInGame: ${config.npcInGame})`);
            Object.assign(updateData, {
                status: 'in_progress',
                round: 1,
                roundStartedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            console.log(`⏳ Waiting for more players: ${finalPlayerCount}/${config.maxPlayers} (npcInGame: ${config.npcInGame})`);
        }

        await gameRef.set(updateData, { merge: true });

        return { 
            success: true, 
            gameId: gameRef.id,
            message: finalPlayerCount >= config.maxPlayers ? 'Game starting now!' : `Waiting for ${config.maxPlayers - finalPlayerCount} more players`,
            entryFee: config.entryFeeSol,
            paymentVerified: true
        };

    } catch (error) {
        console.error('Join lobby error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to join lobby: ' + error.message);
    }
});

// Player Action
exports.playerAction = functions.https.onCall(async (data, context) => {
    const { gameId, playerAddress } = data;
    
    if (!gameId || !playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID and player address required');
    }

    try {
        const config = await getGameConfig();
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
        
        if (!gameDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Game not found');
        }

        const game = gameDoc.data();
        if (game.status !== 'in_progress') {
            throw new functions.https.HttpsError('failed-precondition', 'Game not in progress');
        }

        let players = game.players || {};
        const player = players[playerAddress];
        
        if (!player || player.status !== 'alive') {
            throw new functions.https.HttpsError('failed-precondition', 'Player not alive');
        }

        // Record player action
        players[playerAddress] = {
            ...player,
            lastActionRound: game.round,
            lastActionAt: admin.firestore.FieldValue.serverTimestamp()
        };

        console.log(`⚡ Player ${playerAddress} acted in round ${game.round}`);

        // Update game
        await gameRef.update({
            players: players,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { 
            success: true, 
            message: 'Action recorded',
            round: game.round
        };

    } catch (error) {
        console.error('Player action error:', error);
        throw new functions.https.HttpsError('internal', 'Action failed: ' + error.message);
    }
});

// Fast Game Tick for Real-time Processing
exports.fastGameTick = functions.https.onCall(async (data, context) => {
    try {
        const config = await getGameConfig();
        const now = admin.firestore.Timestamp.now();
        
        // Get all active games
        const activeGamesQuery = db.collection('games').where('status', '==', 'in_progress');
        const activeGames = await activeGamesQuery.get();

        if (activeGames.empty) {
            return { success: true, message: 'No active games' };
        }

        let processedGames = 0;

        for (const doc of activeGames.docs) {
            const game = doc.data();
            const gameRef = doc.ref;
            
            // Check if round should end
            const roundStartTime = game.roundStartedAt.toMillis();
            const elapsedSec = (now.toMillis() - roundStartTime) / 1000;
            
            if (elapsedSec >= config.roundDurationSec) {
                console.log(`⏰ Round ${game.round} timeout for game ${doc.id}`);
                
                let players = { ...game.players };
                
                // Make bots act strategically
                Object.keys(players).forEach(playerId => {
                    const player = players[playerId];
                    if (player.isNpc && player.status === 'alive') {
                        // Check if this bot should be eliminated this round
                        if (player.eliminationRound === game.round) {
                            // Don't act - will be eliminated
                            console.log(`🤖 Bot ${playerId} scheduled for elimination in round ${game.round}`);
                        } else {
                            // Act to survive
                            players[playerId] = { ...player, lastActionRound: game.round };
                        }
                    }
                });

                // Eliminate players who didn't act
                Object.keys(players).forEach(playerId => {
                    const player = players[playerId];
                    if (player.status === 'alive' && player.lastActionRound < game.round) {
                        players[playerId] = { ...player, status: 'eliminated' };
                        console.log(`💀 Eliminated ${playerId} in round ${game.round}`);
                    }
                });

                // Check for winner
                const alivePlayers = Object.values(players).filter(p => p.status === 'alive');
                
                if (alivePlayers.length <= 1) {
                    // Game over - trigger Jupiter swap for winner
                    const winner = alivePlayers[0];
                    console.log(`🎉 Game ${doc.id} complete! Winner: ${winner?.address || 'None'}`);
                    
                    let prizeData = null;
                    if (winner && !winner.isNpc && game.totalSolCollected > 0) {
                        try {
                            // Perform Jupiter swap: SOL → BALL tokens
                            console.log(`🔄 Starting Jupiter swap: ${game.totalSolCollected} SOL → BALL tokens for ${winner.address}`);
                            const swapResult = await performJupiterSwap(config, game.totalSolCollected, winner.address);
                            
                            if (swapResult.success) {
                                // Transfer tokens to winner
                                const transferResult = await transferTokensToWinner(config, winner.address, parseInt(swapResult.outputAmount));
                                
                                prizeData = {
                                    prizeAmountFormatted: (parseInt(swapResult.outputAmount) / Math.pow(10, config.prizeTokenDecimals)).toLocaleString(),
                                    tokenSymbol: config.tokenSymbol,
                                    rawAmount: parseInt(swapResult.outputAmount),
                                    solCollected: game.totalSolCollected,
                                    swapSignature: swapResult.signature,
                                    transferSignature: transferResult.signature || null,
                                    swapSuccess: true,
                                    transferSuccess: transferResult.success || false
                                };
                                
                                if (!transferResult.success) {
                                    prizeData.transferError = transferResult.error;
                                }
                            } else {
                                throw new Error(swapResult.error);
                            }
                        } catch (swapError) {
                            console.error('Jupiter swap failed:', swapError);
                            // Fallback: estimate tokens
                            prizeData = {
                                prizeAmountFormatted: (game.totalSolCollected * 1000000).toLocaleString(),
                                tokenSymbol: config.tokenSymbol,
                                rawAmount: game.totalSolCollected * 1000000,
                                solCollected: game.totalSolCollected,
                                swapFailed: true,
                                error: swapError.message
                            };
                        }
                    }
                    
                    await gameRef.update({
                        status: 'completed',
                        winner: winner?.address || null,
                        players: players,
                        completedAt: now,
                        updatedAt: now,
                        prize: prizeData
                    });
                } else {
                    // Next round
                    const nextRound = game.round + 1;
                    console.log(`➡️ Game ${doc.id} advancing to round ${nextRound}`);
                    
                    await gameRef.update({
                        round: nextRound,
                        roundStartedAt: now,
                        players: players,
                        updatedAt: now
                    });
                }
                
                processedGames++;
            }
        }

        return { 
            success: true, 
            processedGames: processedGames,
            message: `Processed ${processedGames} games`
        };

    } catch (error) {
        console.error('Fast game tick error:', error);
        throw new functions.https.HttpsError('internal', 'Fast tick failed: ' + error.message);
    }
});

// Jupiter Swap Function
async function performJupiterSwap(config, solAmount, winnerAddress) {
    try {
        console.log(`🔄 Performing Jupiter swap: ${solAmount} SOL → ${config.tokenSymbol}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        // Get Jupiter quote
        const quoteParams = new URLSearchParams({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: config.ballTokenMint,
            amount: lamports.toString(),
            slippageBps: '300',
            swapMode: 'ExactIn',
            maxAccounts: '64'
        });
        
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?${quoteParams}`;
        console.log(`📡 Getting Jupiter quote...`);
        
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
            priceImpactPct: quote.priceImpactPct
        });
        
        // Get swap transaction
        console.log(`🏗️ Getting swap transaction from Jupiter...`);
        const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: config.treasuryWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: { maxBps: 500 },
            prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                    maxLamports: 10000000,
                    priorityLevel: "high"
                }
            }
        }, {
            timeout: 15000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!swapResponse.data?.swapTransaction) {
            throw new Error('No swap transaction received from Jupiter');
        }
        
        // Execute swap
        console.log(`✍️ Signing swap transaction...`);
        const transactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([config.treasuryWallet]);
        
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
        
        return {
            success: true,
            signature,
            inputAmount: quote.inAmount,
            outputAmount: quote.outAmount,
            priceImpactPct: quote.priceImpactPct
        };
        
    } catch (error) {
        console.error('❌ Jupiter swap failed:', error?.message || error);
        
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

// Helper function to detect if token uses Token2022 program
async function getTokenProgramId(connection, tokenMint) {
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

// Helper function to format token amounts with decimals
function formatTokenAmount(rawAmount, decimals = 9) {
    const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
    const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
    });
    return formatted;
}

// Transfer tokens to winner
async function transferTokensToWinner(config, winnerAddress, tokenAmount) {
    try {
        const formattedAmount = formatTokenAmount(tokenAmount);
        console.log(`🏆 Distributing ${formattedAmount} BALL tokens (${tokenAmount} raw) to winner: ${winnerAddress}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const winnerPubkey = new PublicKey(winnerAddress);
        const tokenMintPubkey = new PublicKey(config.ballTokenMint);
        
        // Detect the correct token program
        const tokenProgramId = await getTokenProgramId(connection, config.ballTokenMint);
        
        // Get associated token accounts with correct program
        const treasuryTokenAccount = await getAssociatedTokenAddress(
            tokenMintPubkey, 
            config.treasuryWallet.publicKey,
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
                    config.treasuryWallet.publicKey, // payer
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
                    config.treasuryWallet.publicKey, // owner
                    tokenAmount, // amount
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
                    config.treasuryWallet.publicKey, // owner
                    tokenAmount, // amount
                    [], // multiSigners
                    tokenProgramId // programId
                )
            );
        }
        
        // Send transaction
        const transaction = new Transaction().add(...instructions);
        const signature = await connection.sendTransaction(transaction, [config.treasuryWallet]);
        await connection.confirmTransaction(signature);
        
        console.log(`🎉 Token distribution completed! Transaction: ${signature}`);
        return {
            success: true,
            signature,
            amount: tokenAmount
        };
        
    } catch (error) {
        console.error('❌ Token distribution failed:', error);
        return {
            success: false,
            error: error?.message || 'Unknown error during token distribution'
        };
    }
}

// Game Ticker - Runs every minute for round processing
exports.gameTicker = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
    console.log('🎯 Game ticker running...');
    
    try {
        // Call fastGameTick to process rounds
        const result = await exports.fastGameTick({}, {});
        console.log('✅ Game ticker completed:', result);
        return null;
    } catch (error) {
        console.error('Game ticker error:', error);
        return null;
    }
}); 