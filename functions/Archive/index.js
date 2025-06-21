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

let treasuryWallet;

// Initialize treasuryWallet once when the function instance starts
async function initializeTreasuryWallet() {
    console.log('Initializing treasury wallet...');
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

    try {
        console.log('bs58 type:', typeof bs58);
        console.log('bs58.decode type:', typeof bs58.decode);
        
        if (typeof bs58.decode !== 'function') {
            throw new Error('bs58.decode is not a function. bs58 module may not be properly loaded.');
        }
        
        const secretKeyBytes = bs58.decode(privateKey);
        treasuryWallet = Keypair.fromSecretKey(secretKeyBytes);
        console.log('Treasury wallet created successfully during initialization');
    } catch (error) {
        console.error('Error creating treasury wallet during initialization:', error);
        throw new Error('Invalid treasury private key format: ' + error.message);
    }
}

// Call the initialization function immediately
initializeTreasuryWallet();

// Game configuration
async function getGameConfig() {
    const configDoc = await db.collection('config').doc('game').get();
    if (!configDoc.exists) throw new Error('Game configuration not found');
    const configData = configDoc.data() || {};
    
    // Validate required fields
    const requiredFields = ['network', 'rpcUrl', 'prizeTokenMintAddress', 'entryFee', 'tokenSymbol'];
    for (const field of requiredFields) {
        if (!configData[field]) {
            throw new Error(`Missing required config field: ${field}`);
        }
    }

    return {
        network: configData.network,
        rpcUrl: configData.rpcUrl,
        treasuryWallet: treasuryWallet,
        ballTokenMint: configData.prizeTokenMintAddress,
        entryFeeSol: configData.entryFee,
        maxPlayers: configData.maxPlayersPerGame || 5,
        roundDurationSec: configData.roundDurationSec || 5,
        tokenSymbol: configData.tokenSymbol,
        prizeTokenDecimals: configData.prizeTokenDecimals || 9
    };
}

// Get next sequential game ID
async function getNextGameId() {
    const counterRef = db.collection('counters').doc('gameCounter');
    
    return db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        
        let nextNumber = 1;
        if (counterDoc.exists) {
            nextNumber = (counterDoc.data().count || 0) + 1;
        }
        
        transaction.set(counterRef, { count: nextNumber }, { merge: true });
        return `lsdgame${nextNumber}`;
    });
}

// Join Lobby with Multiplayer Logic
exports.joinLobby = functions.region('us-central1').runWith({
    cors: true
}).https.onCall(async (data, context) => {
    const { playerAddress, transactionSignature } = data;
    
    if (!playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Player address required');
    }

    try {
        const config = await getGameConfig();
        console.log(`🎮 Player ${playerAddress} attempting to join multiplayer lobby`);

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
            // No transaction signature - check balance and find/create lobby
            const playerPubkey = new PublicKey(playerAddress);
            const balance = await connection.getBalance(playerPubkey);
            const solBalance = balance / LAMPORTS_PER_SOL;

            if (solBalance < config.entryFeeSol) {
                throw new functions.https.HttpsError('failed-precondition', 
                    `Insufficient SOL balance. Need ${config.entryFeeSol} SOL, have ${solBalance.toFixed(4)} SOL`);
            }
            
            // Check for existing lobbies that this player can join
            console.log(`🔍 Checking for existing lobbies before payment`);
            const existingLobbyQuery = db.collection('games')
                .where('status', 'in', ['waiting', 'lobby'])
                .orderBy('createdAt', 'asc')
                .limit(1);
            
            const existingLobbies = await existingLobbyQuery.get();
            console.log(`🔍 Found ${existingLobbies.size} existing lobbies before payment`);
            
            let targetGameId = null;
            
            if (!existingLobbies.empty) {
                // Found existing lobby - return its ID for payment
                targetGameId = existingLobbies.docs[0].id;
                console.log(`🎯 Will join existing game: ${targetGameId}`);
            } else {
                // No existing lobby - create one now (without adding player yet)
                targetGameId = await getNextGameId();
                const gameRef = db.collection('games').doc(targetGameId);
                
                await gameRef.set({
                    status: 'waiting',
                    players: {},
                    playerCount: 0,
                    round: 0,
                    roundStartedAt: null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    totalSolCollected: 0,
                    entryFeeSol: config.entryFeeSol,
                    ballTokenMint: config.ballTokenMint,
                    tokenSymbol: config.tokenSymbol,
                    maxPlayers: config.maxPlayers,
                    payments: [],
                    countdownStartedAt: null,
                    countdownDuration: 15
                });
                
                console.log(`🆕 Created empty lobby: ${targetGameId} (waiting for payment)`);
            }
            
            // Return payment instruction with target game ID
            return {
                success: false,
                requiresPayment: true,
                entryFee: config.entryFeeSol,
                treasuryAddress: config.treasuryWallet.publicKey.toString(),
                message: `Please send ${config.entryFeeSol} SOL to join game ${targetGameId}`,
                targetGameId: targetGameId,
                existingLobbies: existingLobbies.size
            };
        }

        // Payment will be recorded in game-specific payment summary only
        console.log(`💰 Payment verified: ${config.entryFeeSol} SOL from ${playerAddress}`);

        // Find the specific lobby to join (should exist from first call)
        console.log(`🔍 Looking for existing lobbies to join with payment`);
        
        // First check if this player is already in an active game
        const playerGamesQuery = db.collection('games')
            .where('status', 'in', ['waiting', 'lobby', 'starting', 'in_progress']);
        
        const playerGames = await playerGamesQuery.get();
        const playerActiveGames = [];
        for (const doc of playerGames.docs) {
            const gameData = doc.data();
            if (gameData.players && gameData.players[playerAddress]) {
                playerActiveGames.push(doc.id);
            }
        }
        
        if (playerActiveGames.length > 0) {
            console.log(`🔗 Player already in games: ${playerActiveGames.join(', ')}`);
            throw new functions.https.HttpsError('already-exists', `You are already in game(s): ${playerActiveGames.join(', ')}. Please finish or leave those games first.`);
        }
        
        // Find the oldest available lobby (first created)
        const existingLobbyQuery = db.collection('games')
            .where('status', 'in', ['waiting', 'lobby'])
            .orderBy('createdAt', 'asc')
            .limit(1);
        
        const existingLobbies = await existingLobbyQuery.get();
        console.log(`🔍 Found ${existingLobbies.size} existing lobbies for payment`);
        
        let gameRef;
        let gameData;
        let isNewGame = false;
        
        if (!existingLobbies.empty) {
            gameRef = existingLobbies.docs[0].ref;
            gameData = existingLobbies.docs[0].data();
            console.log(`🔗 Joining existing lobby with payment: ${gameRef.id} (status: ${gameData.status}, players: ${gameData.playerCount})`);
        } else {
            // This shouldn't happen since first call should create a lobby
            console.log(`⚠️ No lobby found for payment - creating emergency lobby`);
            const gameId = await getNextGameId();
            gameRef = db.collection('games').doc(gameId);
            gameData = {
                status: 'waiting',
                players: {},
                playerCount: 0,
                round: 0,
                roundStartedAt: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                totalSolCollected: 0,
                entryFeeSol: config.entryFeeSol,
                ballTokenMint: config.ballTokenMint,
                tokenSymbol: config.tokenSymbol,
                maxPlayers: config.maxPlayers,
                payments: [],
                countdownStartedAt: null,
                countdownDuration: 15
            };
            isNewGame = true;
            console.log(`🆕 Emergency lobby creation: ${gameId}`);
        }

        let players = gameData?.players || {};

        // Check if player already in game
        if (players[playerAddress]) {
            throw new functions.https.HttpsError('already-exists', 'Player already in this game');
        }

        // Add the player
        players[playerAddress] = {
            address: playerAddress,
            name: `Player ${playerAddress.slice(0, 4)}`,
            status: 'alive',
            isNpc: false,
            lastActionRound: 0,
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            solPaid: config.entryFeeSol,
            transactionSignature: transactionSignature,
            responseTime: null, // Will track button press timing
            refundRequested: false // Track if player requested refund
        };
        console.log(`✅ Added player ${playerAddress} to lobby`);

        const playerCount = Object.keys(players).length;
        let newStatus = gameData.status;
        let countdownStartedAt = gameData.countdownStartedAt;
        let message = '';

        // Determine new game state
        if (playerCount === 1) {
            newStatus = 'waiting';
            message = 'Waiting for more players to join...';
        } else if (playerCount >= 2 && playerCount < config.maxPlayers) {
            newStatus = 'lobby';
            countdownStartedAt = admin.firestore.FieldValue.serverTimestamp();
            message = `Game will start with ${playerCount}/${config.maxPlayers} players in 15 seconds. Countdown resets when new players join.`;
        } else if (playerCount >= config.maxPlayers) {
            newStatus = 'starting';
            countdownStartedAt = null;
            message = 'Game is full! Starting now - no refunds allowed.';
        }

        // Update game data
        const updateData = {
            players: players,
            playerCount: playerCount,
            status: newStatus,
            totalSolCollected: admin.firestore.FieldValue.increment(config.entryFeeSol),
            payments: admin.firestore.FieldValue.arrayUnion({
                player: playerAddress,
                signature: transactionSignature,
                amount: config.entryFeeSol
            }),
            countdownStartedAt: countdownStartedAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Start game immediately if max players reached
        if (playerCount >= config.maxPlayers) {
            Object.assign(updateData, {
                status: 'in_progress',
                round: 1,
                roundStartedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Start background SOL to BALL swap for faster prize distribution
            console.log(`🔄 Starting background SOL swap for game ${gameRef.id}`);
            // Note: We'll implement this swap in the background
        }

        await gameRef.set(updateData, { merge: true });

        return { 
            success: true, 
            gameId: gameRef.id,
            message: message,
            entryFee: config.entryFeeSol,
            paymentVerified: true,
            playerCount: playerCount,
            maxPlayers: config.maxPlayers,
            status: newStatus,
            isNewGame: isNewGame
        };

    } catch (error) {
        console.error('Join lobby error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to join lobby: ' + error.message);
    }
});

// Clean up old/stale games
exports.cleanupOldGames = functions.region('us-central1').runWith({
    cors: true
}).https.onCall(async (data, context) => {
    try {
        const { playerAddress } = data;
        
        if (!playerAddress) {
            throw new functions.https.HttpsError('invalid-argument', 'Player address is required');
        }
        
        console.log(`🧹 Cleaning up old games for player: ${playerAddress}`);
        
        // Find all games where this player is present
        const allGamesQuery = db.collection('games');
        const allGames = await allGamesQuery.get();
        
        const gamesToClean = [];
        const batch = db.batch();
        
        for (const doc of allGames.docs) {
            const gameData = doc.data();
            if (gameData.players && gameData.players[playerAddress]) {
                // Check if game is old or in a state that should be cleaned
                const gameAge = Date.now() - (gameData.createdAt?.toDate?.()?.getTime() || 0);
                const isOld = gameAge > 10 * 60 * 1000; // 10 minutes old
                const isStale = ['waiting', 'lobby'].includes(gameData.status) && isOld;
                const isCompleted = gameData.status === 'completed';
                
                if (isStale || isCompleted) {
                    console.log(`🗑️ Marking game ${doc.id} for cleanup (status: ${gameData.status}, age: ${Math.round(gameAge/1000)}s)`);
                    gamesToClean.push(doc.id);
                    
                    // Remove player from game or delete entire game if empty
                    const updatedPlayers = { ...gameData.players };
                    delete updatedPlayers[playerAddress];
                    
                    const remainingPlayerCount = Object.keys(updatedPlayers).length;
                    
                    if (remainingPlayerCount === 0) {
                        // Delete empty game
                        batch.delete(doc.ref);
                    } else {
                        // Remove player from game
                        batch.update(doc.ref, {
                            players: updatedPlayers,
                            playerCount: remainingPlayerCount,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            }
        }
        
        if (gamesToClean.length > 0) {
            await batch.commit();
            console.log(`✅ Cleaned up ${gamesToClean.length} games: ${gamesToClean.join(', ')}`);
        } else {
            console.log(`✅ No games needed cleanup for player: ${playerAddress}`);
        }
        
        return {
            success: true,
            cleanedGames: gamesToClean,
            message: `Cleaned up ${gamesToClean.length} old/completed games`
        };
        
    } catch (error) {
        console.error('❌ Cleanup error:', error);
        throw new functions.https.HttpsError('internal', `Failed to cleanup games: ${error.message}`);
    }
});

// Force start stuck games
exports.forceStartGame = functions.region('us-central1').https.onCall(async (data, context) => {
    try {
        const { gameId } = data;
        
        if (!gameId) {
            throw new functions.https.HttpsError('invalid-argument', 'Game ID is required');
        }
        
        console.log(`🚀 Force starting game: ${gameId}`);
        
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
        
        if (!gameDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Game not found');
        }
        
        const gameData = gameDoc.data();
        
        if (gameData.status === 'in_progress' || gameData.status === 'completed') {
            return {
                success: false,
                message: `Game is already ${gameData.status}`
            };
        }
        
        // Force start the game
        await gameRef.update({
            status: 'in_progress',
            round: 1,
            roundStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Force started game ${gameId}`);
        
        return {
            success: true,
            message: `Game ${gameId} force started`,
            gameId: gameId
        };
        
    } catch (error) {
        console.error('❌ Force start error:', error);
        throw new functions.https.HttpsError('internal', 'Force start failed: ' + error.message);
    }
});

// Simple Refund System - exactly as requested
exports.requestRefund = functions.region('us-central1').runWith({
    cors: true
}).https.onCall(async (data, context) => {
    const { gameId, playerAddress } = data;
    
    if (!gameId || !playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID and player address required');
    }

    try {
        console.log(`💰 Processing refund request for ${playerAddress} in game ${gameId}`);
        
        const config = await getGameConfig();
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
        
        if (!gameDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Game not found');
        }

        let game = gameDoc.data();
        
        // Only allow refunds in waiting/lobby states (before game starts)
        if (!['waiting', 'lobby'].includes(game.status)) {
            throw new functions.https.HttpsError('failed-precondition', 'Refunds not allowed - game has already started');
        }

        let players = game.players || {};
        const player = players[playerAddress];
        
        if (!player) {
            throw new functions.https.HttpsError('not-found', 'Player not found in game');
        }

        if (player.refundRequested) {
            throw new functions.https.HttpsError('already-exists', 'Refund already requested for this player');
        }

        // Step 1: Mark refund as requested
        players[playerAddress].refundRequested = true;
        
        // Step 2: Calculate refund amount (solPaid - 0.0005 fee)
        const refundAmount = player.solPaid - 0.0005; // 0.01 - 0.0005 = 0.0095
        
        if (refundAmount <= 0) {
            throw new functions.https.HttpsError('failed-precondition', 'Refund amount too small after transfer fee');
        }

        console.log(`💰 Refunding ${refundAmount} SOL to ${playerAddress} (original: ${player.solPaid}, fee: 0.0005)`);

        // Step 3: Send SOL refund from treasury wallet to player
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const { Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
        
        const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);
        const fromPubkey = config.treasuryWallet.publicKey;
        const toPubkey = new PublicKey(playerAddress);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey,
                toPubkey,
                lamports: refundLamports,
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromPubkey;
        
        // Sign and send refund transaction
        transaction.sign(config.treasuryWallet);
        const refundSignature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(refundSignature, 'confirmed');
        
        console.log(`✅ Refund transaction confirmed: ${refundSignature}`);

        // Step 4: Remove player from game (4 players → 3 players)
        delete players[playerAddress];
        const newPlayerCount = Object.keys(players).length;
        
        // Step 5: Update game state based on remaining players
        let newStatus = game.status;
        let countdownStartedAt = game.countdownStartedAt;
        
        if (newPlayerCount === 0) {
            newStatus = 'cancelled';
            countdownStartedAt = null;
        } else if (newPlayerCount === 1) {
            newStatus = 'waiting';
            countdownStartedAt = null;
        } else if (newPlayerCount >= 2) {
            newStatus = 'lobby';
            countdownStartedAt = admin.firestore.FieldValue.serverTimestamp(); // Reset countdown
        }

        // Step 6: Update game in Firestore
        await gameRef.update({
            players: players,
            playerCount: newPlayerCount,
            status: newStatus,
            countdownStartedAt: countdownStartedAt,
            totalSolCollected: admin.firestore.FieldValue.increment(-player.solPaid),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ Player removed from game. New player count: ${newPlayerCount}, Status: ${newStatus}`);

        return { 
            success: true, 
            message: `Refund successful! ${refundAmount} SOL sent to your wallet.`,
            refundAmount: refundAmount,
            refundSignature: refundSignature,
            newPlayerCount: newPlayerCount,
            newStatus: newStatus
        };

    } catch (error) {
        console.error('❌ Refund error:', error);
        throw new functions.https.HttpsError('internal', `Refund failed: ${error.message}`);
    }
});

// Player Action with Accurate Response Time Tracking
exports.playerAction = functions.region('us-central1').https.onCall(async (data, context) => {
    const { gameId, playerAddress, clientTimestamp, clientResponseTime, roundStartTime } = data;
    
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

        let game = gameDoc.data();
        
        // Allow actions if game just completed but action was submitted during valid time
        const currentTime = admin.firestore.Timestamp.now();
        const isRecentlyCompleted = game.status === 'completed' && 
            game.completedAt && 
            (currentTime.toMillis() - game.completedAt.toMillis()) < 10000; // Within 10 seconds
        
        if (game.status !== 'in_progress' && !isRecentlyCompleted) {
            throw new functions.https.HttpsError('failed-precondition', `Game not in progress (status: ${game.status})`);
        }
        
        // If game recently completed, don't process the action but return success
        if (isRecentlyCompleted) {
            console.log(`⚠️ Action submitted for recently completed game ${gameId} - ignoring gracefully`);
            return {
                success: true,
                message: 'Game completed, action not processed',
                round: game.round,
                responseTime: clientResponseTime || 0
            };
        }

        let players = { ...game.players };
        const player = players[playerAddress];
        
        if (!player || player.status !== 'alive') {
            throw new functions.https.HttpsError('failed-precondition', 'Player not alive');
        }

        const now = admin.firestore.Timestamp.now();
        
        // Use client-side response time if available (more accurate), otherwise calculate server-side
        let responseTimeMs;
        if (clientResponseTime !== null && clientResponseTime !== undefined) {
            responseTimeMs = clientResponseTime;
            console.log(`⚡ Player ${playerAddress} acted in round ${game.round} - Client response time: ${responseTimeMs}ms`);
        } else {
            // Fallback to server-side calculation
            const roundStartTimeMs = game.roundStartedAt.toMillis();
            responseTimeMs = now.toMillis() - roundStartTimeMs;
            console.log(`⚡ Player ${playerAddress} acted in round ${game.round} - Server response time: ${responseTimeMs}ms`);
        }
        
        // Record player action with response time
        players[playerAddress] = {
            ...player,
            lastActionRound: game.round,
            lastActionAt: now,
            responseTime: responseTimeMs,
            clientTimestamp: clientTimestamp || null,
            clientResponseTime: clientResponseTime || null,
            clientRoundStartTime: roundStartTime || null
        };

        // Update game
        await gameRef.update({
            players: players,
            updatedAt: now
        });

        return { 
            success: true, 
            message: 'Action recorded',
            round: game.round,
            responseTime: responseTimeMs
        };

    } catch (error) {
        console.error('Player action error:', error);
        throw new functions.https.HttpsError('internal', 'Action failed: ' + error.message);
    }
});

// Track processing locks to prevent duplicate calls
const gameProcessingLocks = new Map();

// Internal game processing function with duplicate call prevention
async function processGameRounds() {
    const config = await getGameConfig();
    const now = admin.firestore.Timestamp.now();
    
    // Get all active games, lobby games with expired countdowns, and starting games
    const activeGamesQuery = db.collection('games').where('status', 'in', ['in_progress', 'lobby', 'starting']);
    const activeGames = await activeGamesQuery.get();

    if (activeGames.empty) {
        return { success: true, message: 'No active games' };
    }

    let processedGames = 0;

    for (let doc of activeGames.docs) {
        const gameId = doc.id;
        
        // Check if this game is already being processed
        if (gameProcessingLocks.has(gameId)) {
            const lockTime = gameProcessingLocks.get(gameId);
            const lockAge = Date.now() - lockTime;
            
            // If lock is older than 30 seconds, assume it's stale and remove it
            if (lockAge > 30000) {
                console.log(`⚠️ Removing stale processing lock for game ${gameId} (${lockAge}ms old)`);
                gameProcessingLocks.delete(gameId);
            } else {
                console.log(`⏭️ Skipping game ${gameId} - already being processed (lock age: ${lockAge}ms)`);
                continue;
            }
        }
        
        // Set processing lock
        gameProcessingLocks.set(gameId, Date.now());
        
        try {
            let game = doc.data();
            const gameRef = doc.ref;
            
            console.log(`🔒 Processing game ${gameId} (status: ${game.status})`);
        
            // Handle starting state - immediately transition to in_progress
            if (game.status === 'starting') {
                console.log(`🚀 Starting game ${doc.id} with ${game.playerCount} players`);
                
                await gameRef.update({
                    status: 'in_progress',
                    round: 1,
                    roundStartedAt: now,
                    updatedAt: now
                });
                
                processedGames++;
                continue;
            }
        
        // Handle lobby countdown expiration
        if (game.status === 'lobby' && game.countdownStartedAt) {
            const countdownStartTime = game.countdownStartedAt.toMillis();
            const countdownElapsed = (now.toMillis() - countdownStartTime) / 1000;
            
            if (countdownElapsed >= game.countdownDuration) {
                console.log(`⏰ Lobby countdown expired for game ${doc.id} - Starting with ${game.playerCount} players`);
                
                // Start the game
                await gameRef.update({
                    status: 'in_progress',
                    round: 1,
                    roundStartedAt: now,
                    countdownStartedAt: null,
                    updatedAt: now
                });
                
                processedGames++;
                continue;
            }
        }
        
        // Handle active game rounds
        if (game.status === 'in_progress' && game.roundStartedAt) {
            const roundStartTime = game.roundStartedAt.toMillis();
            const elapsedSec = (now.toMillis() - roundStartTime) / 1000;
            
            // Add 5-second buffer for player actions to be submitted (more generous)
            if (elapsedSec >= (config.roundDurationSec + 5)) {
                console.log(`⏰ Round ${game.round} timeout for game ${doc.id}`);
                
                // Re-fetch game data to ensure all player actions are captured
                const latestGameDoc = await gameRef.get();
                if (!latestGameDoc.exists) {
                    console.log(`⚠️ Game ${doc.id} disappeared during round processing.`);
                    continue; // Skip this game if it no longer exists
                }
                
                const latestGameData = latestGameDoc.data();
                console.log(`🔄 Re-fetched game data for ${doc.id}. Player count: ${latestGameData.playerCount}`);

                // CRITICAL FIX: Merge latest player data instead of overwriting
                // This prevents losing player actions that occurred between initial fetch and processing
                const mergedPlayers = { ...game.players };
                
                // Merge in any new/updated player data from the latest fetch
                if (latestGameData.players) {
                    Object.keys(latestGameData.players).forEach(playerAddress => {
                        const latestPlayer = latestGameData.players[playerAddress];
                        const existingPlayer = mergedPlayers[playerAddress] || {};
                        
                        // Merge player data, keeping the most recent action data
                        mergedPlayers[playerAddress] = {
                            ...existingPlayer,
                            ...latestPlayer,
                            // Always keep the highest action round and most recent response time
                            lastActionRound: Math.max(
                                existingPlayer.lastActionRound || 0, 
                                latestPlayer.lastActionRound || 0
                            ),
                            lastActionAt: latestPlayer.lastActionAt || existingPlayer.lastActionAt,
                            responseTime: latestPlayer.responseTime ?? existingPlayer.responseTime,
                            clientTimestamp: latestPlayer.clientTimestamp ?? existingPlayer.clientTimestamp,
                            clientResponseTime: latestPlayer.clientResponseTime ?? existingPlayer.clientResponseTime
                        };
                    });
                }
                
                // Update the game object with merged data and latest non-player fields
                game = {
                    ...game,
                    ...latestGameData,
                    players: mergedPlayers
                };
                
                console.log(`🔄 Merged player data - Actions preserved for round ${game.round}`);
                console.log(`🔍 Player action status:`, Object.keys(mergedPlayers).map(addr => 
                    `${addr.slice(0,4)}: R${mergedPlayers[addr].lastActionRound || 0}/${game.round} (${mergedPlayers[addr].responseTime || 'N/A'}ms)`
                ).join(', '));

                let players = { ...mergedPlayers };
                
                // Get all alive players who acted this round
                const alivePlayersWhoActed = Object.values(players).filter(p => 
                    p.status === 'alive' && 
                    p.lastActionRound === game.round &&
                    !p.isNpc
                );
                
                // Get all alive players who didn't act
                const alivePlayersWhoDidntAct = Object.values(players).filter(p => 
                    p.status === 'alive' && 
                    p.lastActionRound < game.round &&
                    !p.isNpc
                );
                
                console.log(`📊 Round ${game.round} stats: ${alivePlayersWhoActed.length} acted, ${alivePlayersWhoDidntAct.length} didn't act`);
                
                // DEBUGGING: Log detailed player action status
                console.log(`🔍 DETAILED PLAYER STATUS for Round ${game.round}:`);
                Object.values(players).filter(p => !p.isNpc).forEach(player => {
                    console.log(`   ${player.address.slice(0,8)}: Round ${player.lastActionRound || 0}/${game.round}, ` +
                               `Response: ${player.responseTime || 'NULL'}ms, Status: ${player.status}, ` +
                               `ClientTime: ${player.clientResponseTime || 'NULL'}ms`);
                });
                
                if (alivePlayersWhoActed.length === 0 && alivePlayersWhoDidntAct.length > 0) {
                    console.log(`⚠️ CRITICAL: NO players acted in round ${game.round} but ${alivePlayersWhoDidntAct.length} players are alive!`);
                    console.log(`⚠️ This indicates a race condition or action recording failure!`);
                }
                
                // Eliminate players based on response time (slowest gets eliminated)
                if (alivePlayersWhoActed.length > 1) {
                    // Sort by response time (slowest first) - FIXED: Ensure proper sorting
                    alivePlayersWhoActed.sort((a, b) => {
                        const aTime = a.responseTime || 0;
                        const bTime = b.responseTime || 0;
                        return bTime - aTime; // Descending order (slowest first)
                    });
                    
                    // Eliminate the slowest player
                    const slowestPlayer = alivePlayersWhoActed[0];
                    players[slowestPlayer.address] = { 
                        ...slowestPlayer, 
                        status: 'eliminated',
                        eliminatedAt: now,
                        eliminationReason: 'slowest_response'
                    };
                    console.log(`🐌 Eliminated slowest player ${slowestPlayer.address} - Response time: ${slowestPlayer.responseTime}ms`);
                    console.log(`🏃 Survivors: ${alivePlayersWhoActed.slice(1).map(p => `${p.address.slice(0,4)} (${p.responseTime}ms)`).join(', ')}`);
                } else if (alivePlayersWhoDidntAct.length > 0) {
                    // Eliminate all players who didn't act
                    alivePlayersWhoDidntAct.forEach(player => {
                        players[player.address] = { 
                            ...player, 
                            status: 'eliminated',
                            eliminatedAt: now,
                            eliminationReason: 'no_action'
                        };
                        console.log(`💀 Eliminated ${player.address} for not acting in round ${game.round}`);
                    });
                }
                
                // Check for winner - ALWAYS declare a winner
                const alivePlayers = Object.values(players).filter(p => p.status === 'alive' && !p.isNpc);
                const allPlayers = Object.values(players).filter(p => !p.isNpc);
                
                console.log(`🔍 Winner determination: ${alivePlayers.length} alive players, ${allPlayers.length} total players`);
                console.log(`🔍 Alive players:`, alivePlayers.map(p => `${p.address.slice(0,8)} (${p.responseTime}ms)`));
                console.log(`🔍 All players:`, allPlayers.map(p => `${p.address.slice(0,8)} - ${p.status} (${p.responseTime}ms)`));
                
                if (alivePlayers.length <= 1) {
                    // Game over - determine winner
                    let winner = alivePlayers[0]; // Surviving player wins
                    console.log(`🎯 Initial winner selection: ${winner ? winner.address.slice(0,8) : 'NONE'} (survivor)`);
                    
                    // If no survivors (everyone eliminated), pick winner based on best performance
                    if (!winner && allPlayers.length > 0) {
                        console.log(`🎯 No survivors - determining winner from eliminated players`);
                        
                        // Find players who acted this round (fastest response time wins)
                        const playersWhoActed = allPlayers.filter(p => 
                            p.lastActionRound === game.round && 
                            p.responseTime !== null
                        );
                        
                        if (playersWhoActed.length > 0) {
                            // Winner = fastest response time among those who acted
                            playersWhoActed.sort((a, b) => (a.responseTime || 999999) - (b.responseTime || 999999));
                            winner = playersWhoActed[0];
                            console.log(`🏆 Winner by fastest response: ${winner.address} (${winner.responseTime}ms)`);
                        } else {
                            // No one acted this round - pick winner by overall best performance
                            // Sort by: 1) Latest elimination round, 2) Fastest response time, 3) First to join
                            allPlayers.sort((a, b) => {
                                // Higher round = better performance
                                if (a.lastActionRound !== b.lastActionRound) {
                                    return (b.lastActionRound || 0) - (a.lastActionRound || 0);
                                }
                                // Faster response = better performance
                                if ((a.responseTime || 999999) !== (b.responseTime || 999999)) {
                                    return (a.responseTime || 999999) - (b.responseTime || 999999);
                                }
                                // Earlier join time = better (first come, first served)
                                return (a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0);
                            });
                            winner = allPlayers[0];
                            console.log(`🏆 Winner by best overall performance: ${winner.address}`);
                        }
                        
                        // Revive the winner
                        players[winner.address] = { ...winner, status: 'alive' };
                        console.log(`🔄 Revived fallback winner: ${winner.address.slice(0,8)}`);
                    }
                    
                    console.log(`🎉 Multiplayer game ${doc.id} complete! Winner: ${winner?.address || 'None'}`);
                    console.log(`🎯 FINAL WINNER CONFIRMATION: ${winner?.address} (${winner?.responseTime}ms)`);
                    
                    let prizeData = null;
                    if (winner && game.totalSolCollected > 0) {
                        try {
                            // Try direct swap to winner first (more reliable)
                            console.log(`🔄 Starting DIRECT Jupiter swap: ${game.totalSolCollected} SOL → ${config.tokenSymbol} to ${winner.address}`);
                            console.log(`💰 PRIZE RECIPIENT CONFIRMED: ${winner.address}`);
                            const swapResult = await performDirectSwapToWinner(config, game.totalSolCollected, winner.address);
                            
                            if (swapResult.success) {
                                // Get connection for token decimals lookup
                                const connection = new Connection(config.rpcUrl, 'confirmed');
                                
                                // Automatically detect token decimals from the blockchain
                                const tokenDecimals = await getTokenDecimals(connection, config.ballTokenMint);
                                
                                // Jupiter returns the actual token amount (in smallest units)
                                const actualTokenAmount = parseInt(swapResult.outputAmount);
                                
                                // Calculate formatted amount using detected decimals
                                const formattedAmount = (actualTokenAmount / Math.pow(10, tokenDecimals)).toFixed(2);
                                
                                console.log(`💰 Prize calculation: ${actualTokenAmount} raw tokens / 10^${tokenDecimals} = ${formattedAmount} ${config.tokenSymbol}`);
                                
                                // If direct swap, no separate transfer needed
                                if (swapResult.directTransfer) {
                                    console.log(`✅ Direct swap successful - tokens sent directly to winner`);
                                    prizeData = {
                                        prizeAmountFormatted: parseFloat(formattedAmount).toLocaleString(),
                                        tokenSymbol: config.tokenSymbol,
                                        rawAmount: actualTokenAmount,
                                        solCollected: game.totalSolCollected,
                                        swapSignature: swapResult.signature,
                                        transferSignature: swapResult.signature, // Same signature for direct
                                        swapSuccess: true,
                                        transferSuccess: true, // Direct transfer succeeded
                                        jupiterQuoteAmount: swapResult.outputAmount,
                                        tokenDecimals: tokenDecimals,
                                        tokenMint: config.ballTokenMint,
                                        directTransfer: true // Flag for direct transfer
                                    };
                                } else {
                                    // Fallback: separate transfer needed
                                    console.log(`⚠️ Fallback: performing separate transfer`);
                                    const transferResult = await transferTokensToWinnerWithRetry(config, winner.address, actualTokenAmount);
                                    
                                    prizeData = {
                                        prizeAmountFormatted: parseFloat(formattedAmount).toLocaleString(),
                                        tokenSymbol: config.tokenSymbol,
                                        rawAmount: actualTokenAmount,
                                        solCollected: game.totalSolCollected,
                                        swapSignature: swapResult.signature,
                                        transferSignature: transferResult.signature || null,
                                        swapSuccess: true,
                                        transferSuccess: transferResult.success || false,
                                        jupiterQuoteAmount: swapResult.outputAmount,
                                        tokenDecimals: tokenDecimals,
                                        tokenMint: config.ballTokenMint,
                                        directTransfer: false
                                    };
                                    
                                    if (!transferResult.success) {
                                        prizeData.transferError = transferResult.error;
                                    }
                                }
                            } else {
                                throw new Error(swapResult.error);
                            }
                        } catch (swapError) {
                            console.error('Jupiter swap failed:', swapError);
                            
                            // Check if it's a balance issue
                            const isBalanceIssue = swapError.message.includes('Insufficient treasury balance') || 
                                                  swapError.message.includes('insufficient funds');
                            
                            // Fallback: Get Jupiter quote for accurate prize estimation (even if swap failed)
                            let estimatedAmount = game.totalSolCollected * 140; // Conservative USDC fallback
                            let estimatedFormatted = estimatedAmount.toFixed(2);
                            let jupiterQuoteAmount = null;
                            
                            try {
                                // Get Jupiter quote for accurate estimation - this should work even if balance is low
                                console.log(`📊 Getting Jupiter quote for prize estimation after swap failure...`);
                                const lamports = Math.floor(game.totalSolCollected * LAMPORTS_PER_SOL);
                                const quoteParams = new URLSearchParams({
                                    inputMint: 'So11111111111111111111111111111111111111112',
                                    outputMint: config.ballTokenMint,
                                    amount: lamports.toString(),
                                    slippageBps: '300'
                                });
                                
                                const quoteUrl = `https://quote-api.jup.ag/v6/quote?${quoteParams}`;
                                const quoteResponse = await axios.get(quoteUrl, { timeout: 5000 });
                                
                                if (quoteResponse.data?.outAmount) {
                                    const tokenDecimals = await getTokenDecimals(new Connection(config.rpcUrl), config.ballTokenMint);
                                    estimatedAmount = parseInt(quoteResponse.data.outAmount) / Math.pow(10, tokenDecimals);
                                    estimatedFormatted = estimatedAmount.toFixed(2);
                                    jupiterQuoteAmount = quoteResponse.data.outAmount;
                                    console.log(`✅ Jupiter quote successful: ${estimatedFormatted} ${config.tokenSymbol} (${jupiterQuoteAmount} raw)`);
                                } else {
                                    console.log(`⚠️ Jupiter quote returned no data`);
                                }
                            } catch (quoteError) {
                                console.log(`⚠️ Jupiter quote also failed: ${quoteError.message}`);
                            }
                            
                            prizeData = {
                                prizeAmountFormatted: estimatedFormatted,
                                tokenSymbol: config.tokenSymbol,
                                rawAmount: jupiterQuoteAmount ? parseInt(jupiterQuoteAmount) : Math.floor(estimatedAmount * Math.pow(10, 6)),
                                solCollected: game.totalSolCollected,
                                swapFailed: true,
                                error: swapError.message,
                                isBalanceIssue: isBalanceIssue,
                                recommendedAction: isBalanceIssue ? 'Fund treasury wallet with more SOL' : 'Check Jupiter API status',
                                jupiterQuoteAmount: jupiterQuoteAmount, // Store the quote amount we got
                                usedJupiterQuote: !!jupiterQuoteAmount // Flag indicating we used real quote vs estimate
                            };
                        }
                    }
                    
                    // Debug logging for prize data
                    console.log(`🏆 Setting prize data for game ${doc.id}:`, JSON.stringify(prizeData, null, 2));
                    
                    // Create comprehensive final game data
                    const finalGameData = {
                        status: 'completed',
                        winner: winner?.address || null,
                        players: players,
                        completedAt: now,
                        updatedAt: now,
                        prize: prizeData,
                        finalStats: {
                            totalPlayers: Object.keys(players).filter(p => !players[p].isNpc).length,
                            totalRounds: game.round,
                            winnerResponseTime: winner?.responseTime || null,
                            eliminationOrder: Object.values(players)
                                .filter(p => p.status === 'eliminated' && !p.isNpc)
                                .sort((a, b) => (b.lastActionRound || 0) - (a.lastActionRound || 0))
                                .map(p => ({
                                    address: p.address,
                                    eliminationRound: p.lastActionRound,
                                    responseTime: p.responseTime,
                                    eliminationReason: p.eliminationReason
                                }))
                        }
                    };
                    
                    await gameRef.update(finalGameData);
                    
                    // Store game-specific payment summary
                    await storeGamePaymentSummary(doc.id, game, players);
                } else {
                    // Next round - reset response times
                    Object.keys(players).forEach(playerId => {
                        if (players[playerId].status === 'alive') {
                            players[playerId] = { ...players[playerId], responseTime: null };
                        }
                    });
                    
                    const nextRound = game.round + 1;
                    console.log(`➡️ Multiplayer game ${doc.id} advancing to round ${nextRound} with ${alivePlayers.length} players`);
                    
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
        } catch (gameError) {
            console.error(`❌ Error processing game ${gameId}:`, gameError);
        } finally {
            // Always remove the processing lock when done
            gameProcessingLocks.delete(gameId);
            console.log(`🔓 Released processing lock for game ${gameId}`);
        }
    }

    return { 
        success: true, 
        processedGames: processedGames,
        message: `Processed ${processedGames} games`
    };
}

// Store game-specific payment summary
async function storeGamePaymentSummary(gameId, gameData, players) {
    try {
        const paymentSummary = {
            gameId: gameId,
            totalPlayers: Object.keys(players).filter(p => !players[p].isNpc).length,
            totalAmountCollected: gameData.totalSolCollected,
            entryFeePerPlayer: gameData.entryFeeSol,
            players: Object.values(players)
                .filter(p => !p.isNpc)
                .map(p => ({
                    address: p.address,
                    amountPaid: p.solPaid,
                    transactionSignature: p.transactionSignature,
                    joinedAt: p.joinedAt,
                    finalStatus: p.status,
                    responseTime: p.responseTime || null
                })),
            gameCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            prizeDistributed: gameData.totalSolCollected > 0
        };
        
        await db.collection('payments').doc(`${gameId}payments`).set(paymentSummary);
        console.log(`💰 Payment summary stored for game ${gameId}`);
    } catch (error) {
        console.error(`❌ Error storing payment summary for game ${gameId}:`, error);
    }
}

// Fast Game Tick for Real-time Processing (HTTPS Callable)
// Fast Game Tick - Manual trigger
exports.fastGameTick = functions.region('us-central1').https.onCall(async (data, context) => {
    try {
        return await processGameRounds();
    } catch (error) {
        console.error('Fast game tick error:', error);
        throw new functions.https.HttpsError('internal', 'Fast tick failed: ' + error.message);
    }
});

// Add new recovery function for failed transfers
exports.retryFailedTransfer = functions.region('us-central1').https.onCall(async (data, context) => {
    const { gameId } = data;
    
    if (!gameId) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID required');
    }

    try {
        console.log(`🔄 Attempting to retry failed transfer for game: ${gameId}`);
        
        const config = await getGameConfig();
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
        
        if (!gameDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Game not found');
        }

        const game = gameDoc.data();
        
        if (game.status !== 'completed') {
            throw new functions.https.HttpsError('failed-precondition', 'Game is not completed');
        }

        if (!game.winner) {
            throw new functions.https.HttpsError('failed-precondition', 'No winner found');
        }

        if (!game.prize || !game.prize.swapSuccess) {
            throw new functions.https.HttpsError('failed-precondition', 'No successful swap found to retry');
        }

        if (game.prize.transferSuccess) {
            throw new functions.https.HttpsError('already-exists', 'Transfer already successful');
        }

        console.log(`🎯 Retrying transfer for winner: ${game.winner}`);
        console.log(`💰 Token amount: ${game.prize.rawAmount} (${game.prize.prizeAmountFormatted} ${game.prize.tokenSymbol})`);

        // Retry the transfer
        const transferResult = await transferTokensToWinnerWithRetry(config, game.winner, game.prize.rawAmount);
        
        // Update the prize data with retry result
        const updatedPrizeData = {
            ...game.prize,
            transferSuccess: transferResult.success,
            transferSignature: transferResult.signature || null,
            retryAttempted: true,
            retryAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (!transferResult.success) {
            updatedPrizeData.retryError = transferResult.error;
        } else {
            // Clear previous error if retry succeeded
            delete updatedPrizeData.transferError;
        }

        await gameRef.update({
            prize: updatedPrizeData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            success: transferResult.success,
            message: transferResult.success ? 
                `Transfer successful! ${game.prize.prizeAmountFormatted} ${game.prize.tokenSymbol} sent to ${game.winner}` :
                `Transfer retry failed: ${transferResult.error}`,
            transferSignature: transferResult.signature,
            gameId: gameId
        };

    } catch (error) {
        console.error('❌ Retry transfer error:', error);
        throw new functions.https.HttpsError('internal', 'Retry failed: ' + error.message);
    }
});

// Add function to list games needing transfer retry
exports.listFailedTransfers = functions.region('us-central1').https.onCall(async (data, context) => {
    try {
        console.log('🔍 Searching for games with failed transfers...');
        
        const gamesQuery = db.collection('games')
            .where('status', '==', 'completed')
            .orderBy('completedAt', 'desc')
            .limit(50);
        
        const games = await gamesQuery.get();
        const failedTransfers = [];
        
        for (const doc of games.docs) {
            const game = doc.data();
            
            if (game.prize && 
                game.prize.swapSuccess && 
                !game.prize.transferSuccess && 
                game.winner) {
                
                failedTransfers.push({
                    gameId: doc.id,
                    winner: game.winner,
                    prizeAmount: game.prize.prizeAmountFormatted,
                    tokenSymbol: game.prize.tokenSymbol,
                    completedAt: game.completedAt,
                    swapSignature: game.prize.swapSignature,
                    transferError: game.prize.transferError || 'Unknown error',
                    retryAttempted: game.prize.retryAttempted || false
                });
            }
        }
        
        console.log(`📊 Found ${failedTransfers.length} games with failed transfers`);
        
        return {
            success: true,
            failedTransfers: failedTransfers,
            count: failedTransfers.length
        };
        
    } catch (error) {
        console.error('❌ List failed transfers error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to list transfers: ' + error.message);
    }
});

// Improved Jupiter Swap Function - Direct to Winner
async function performDirectSwapToWinner(config, solAmount, winnerAddress) {
    try {
        console.log(`🔄 Performing DIRECT Jupiter swap: ${solAmount} SOL → ${config.tokenSymbol} to ${winnerAddress}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        // Check treasury wallet balance first
        const treasuryBalance = await connection.getBalance(config.treasuryWallet.publicKey);
        const treasuryBalanceSol = treasuryBalance / LAMPORTS_PER_SOL;
        const requiredSol = solAmount + 0.003; // Buffer for fees and rent
        
        console.log(`💰 Treasury balance: ${treasuryBalanceSol} SOL`);
        console.log(`💰 Required for swap: ${requiredSol} SOL (${solAmount} + 0.003 buffer)`);
        
        if (treasuryBalance < Math.floor(requiredSol * LAMPORTS_PER_SOL)) {
            throw new Error(`Insufficient treasury balance: need ${requiredSol} SOL, have ${treasuryBalanceSol} SOL`);
        }
        
        // Get winner's token account address
        const winnerPubkey = new PublicKey(winnerAddress);
        const tokenMintPubkey = new PublicKey(config.ballTokenMint);
        
        // Detect token program
        const tokenProgramId = await getTokenProgramId(connection, config.ballTokenMint);
        
        const winnerTokenAccount = await getAssociatedTokenAddress(
            tokenMintPubkey,
            winnerPubkey,
            false,
            tokenProgramId
        );
        
        console.log(`🎯 Winner token account: ${winnerTokenAccount.toString()}`);
        
        // Get Jupiter quote with winner as destination
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
        
        // Get swap transaction with destination override
        console.log(`🏗️ Getting swap transaction from Jupiter (direct to winner)...`);
        const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: config.treasuryWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: { maxBps: 500 },
            destinationTokenAccount: winnerTokenAccount.toString(), // Direct to winner
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
            console.log('⚠️ Direct swap failed, falling back to treasury swap + transfer');
            return await performJupiterSwap(config, solAmount, winnerAddress);
        }
        
        // Execute direct swap
        console.log(`✍️ Signing direct swap transaction...`);
        const transactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([config.treasuryWallet]);
        
        console.log(`📤 Sending direct swap transaction to Solana...`);
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
        
        console.log(`🎉 Direct Jupiter swap completed successfully!`);
        console.log(`📝 Transaction: https://solscan.io/tx/${signature}`);
        
        return {
            success: true,
            signature,
            inputAmount: quote.inAmount,
            outputAmount: quote.outAmount,
            priceImpactPct: quote.priceImpactPct,
            directTransfer: true // Flag to indicate this was direct
        };
        
    } catch (error) {
        console.error('❌ Direct Jupiter swap failed:', error?.message || error);
        
        if (error?.response?.data) {
            console.error('🔍 Jupiter API error details:', error.response.data);
        }
        
        // Fallback to original method
        console.log('🔄 Falling back to treasury swap + transfer method...');
        return await performJupiterSwap(config, solAmount, winnerAddress);
    }
}

// Original Jupiter Swap Function (for fallback)
async function performJupiterSwap(config, solAmount, winnerAddress) {
    try {
        console.log(`🔄 Performing Jupiter swap: ${solAmount} SOL → ${config.tokenSymbol}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        // Check treasury wallet balance first
        const treasuryBalance = await connection.getBalance(config.treasuryWallet.publicKey);
        const treasuryBalanceSol = treasuryBalance / LAMPORTS_PER_SOL;
        const requiredSol = solAmount + 0.003; // Reduced buffer for fees and rent
        
        console.log(`💰 Treasury balance: ${treasuryBalanceSol} SOL`);
        console.log(`💰 Required for swap: ${requiredSol} SOL (${solAmount} + 0.003 buffer)`);
        
        if (treasuryBalance < Math.floor(requiredSol * LAMPORTS_PER_SOL)) {
            throw new Error(`Insufficient treasury balance: need ${requiredSol} SOL, have ${treasuryBalanceSol} SOL`);
        }
        
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
            console.log('🔍 Detected Token2022 program for token');
            return TOKEN_2022_PROGRAM_ID;
        } else {
            console.log('🔍 Detected legacy SPL Token program for token');
            return TOKEN_PROGRAM_ID;
        }
    } catch (error) {
        console.log('⚠️ Could not detect token program, defaulting to SPL Token');
        return TOKEN_PROGRAM_ID;
    }
}

// Helper function to get token decimals from mint account
async function getTokenDecimals(connection, tokenMint) {
    try {
        console.log(`🔍 Getting decimals for token: ${tokenMint}`);
        const mintPubkey = new PublicKey(tokenMint);
        const mintInfo = await connection.getAccountInfo(mintPubkey);
        
        if (!mintInfo) {
            console.log('⚠️ Token mint account not found, defaulting to 6 decimals');
            return 6;
        }
        
        // Parse mint data to get decimals
        // For both SPL Token and Token2022, decimals is at byte offset 44
        const decimals = mintInfo.data[44];
        console.log(`✅ Token ${tokenMint} has ${decimals} decimals`);
        return decimals;
        
    } catch (error) {
        console.error('❌ Error getting token decimals:', error);
        console.log('⚠️ Defaulting to 6 decimals (USDC standard)');
        return 6; // Default to USDC standard
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

// Transfer tokens to winner with retry logic
async function transferTokensToWinnerWithRetry(config, winnerAddress, tokenAmount, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔄 Transfer attempt ${attempt}/${maxRetries} for ${winnerAddress}`);
        
        const result = await transferTokensToWinner(config, winnerAddress, tokenAmount);
        
        if (result.success) {
            console.log(`✅ Transfer successful on attempt ${attempt}`);
            return result;
        }
        
        console.log(`❌ Transfer attempt ${attempt} failed: ${result.error}`);
        
        if (attempt < maxRetries) {
            const delay = attempt * 2000; // 2s, 4s, 6s delays
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    console.log(`💀 All ${maxRetries} transfer attempts failed`);
    return {
        success: false,
        error: `Failed after ${maxRetries} attempts`,
        finalAttemptError: 'Max retries exceeded'
    };
}

// Transfer tokens to winner
async function transferTokensToWinner(config, winnerAddress, tokenAmount) {
    try {
        console.log(`🎯 TRANSFER FUNCTION CALLED WITH WINNER: ${winnerAddress}`);
        console.log(`🎯 Token amount to transfer: ${tokenAmount}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const winnerPubkey = new PublicKey(winnerAddress);
        const tokenMintPubkey = new PublicKey(config.ballTokenMint);
        
        // Detect the correct token program and decimals
        const tokenProgramId = await getTokenProgramId(connection, config.ballTokenMint);
        const tokenDecimals = await getTokenDecimals(connection, config.ballTokenMint);
        
        const formattedAmount = formatTokenAmount(tokenAmount, tokenDecimals);
        console.log(`🏆 Distributing ${formattedAmount} ${config.tokenSymbol} tokens (${tokenAmount} raw) to winner: ${winnerAddress}`);
        console.log(`🎯 FINAL CONFIRMATION - SENDING TO: ${winnerAddress}`);
        
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
        
        // Check treasury token balance first
        try {
            const treasuryBalance = await connection.getTokenAccountBalance(treasuryTokenAccount);
            const availableTokens = parseInt(treasuryBalance.value.amount);
            console.log(`💰 Treasury balance: ${availableTokens} raw tokens (${formatTokenAmount(availableTokens, tokenDecimals)} ${config.tokenSymbol})`);
            
            if (availableTokens < tokenAmount) {
                throw new Error(`Insufficient treasury balance: need ${tokenAmount}, have ${availableTokens}`);
            }
        } catch (balanceError) {
            console.error('❌ Error checking treasury balance:', balanceError);
            // Continue anyway - let the transfer fail with proper error
        }
        
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
                    tokenDecimals, // decimals (detected from mint)
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
        
        // Send transaction with better error handling
        const transaction = new Transaction().add(...instructions);
        
        // Get latest blockhash for better reliability
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = config.treasuryWallet.publicKey;
        
        // Simulate transaction first to catch errors early
        try {
            const simulation = await connection.simulateTransaction(transaction);
            if (simulation.value.err) {
                throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
            }
            console.log(`✅ Transaction simulation successful`);
        } catch (simError) {
            console.error('❌ Transaction simulation failed:', simError);
            throw simError;
        }
        
        // Send and confirm transaction
        const signature = await connection.sendTransaction(transaction, [config.treasuryWallet], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3
        });
        
        console.log(`📤 Transaction sent: ${signature}`);
        
        // Confirm with timeout and better error handling
        console.log(`⏳ Confirming transaction with blockhash: ${blockhash.slice(0,8)}...`);
        
        try {
            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
            }, 'confirmed');
            
            console.log(`📋 Confirmation result:`, confirmation);
            
            if (confirmation.value.err) {
                throw new Error(`Transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            
            // Double-check by fetching the transaction
            const txInfo = await connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (!txInfo) {
                throw new Error('Transaction not found after confirmation');
            }
            
            if (txInfo.meta?.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`);
            }
            
            console.log(`✅ Transaction confirmed and verified on-chain`);
            
        } catch (confirmError) {
            console.error('❌ Confirmation error:', confirmError);
            
            // Try to get transaction info to see what happened
            try {
                const txInfo = await connection.getTransaction(signature, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0
                });
                
                if (txInfo) {
                    console.log(`📋 Transaction found despite confirmation error:`, txInfo.meta);
                    if (!txInfo.meta?.err) {
                        console.log(`✅ Transaction actually succeeded despite confirmation error`);
                        // Continue with success
                    } else {
                        throw new Error(`Transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
                    }
                } else {
                    throw confirmError;
                }
            } catch (fetchError) {
                console.error('❌ Could not fetch transaction info:', fetchError);
                throw confirmError;
            }
        }
        
        console.log(`🎉 Token distribution completed! Transaction: ${signature}`);
        console.log(`🔗 View on Solscan: https://solscan.io/tx/${signature}`);
        
        return {
            success: true,
            signature,
            amount: tokenAmount,
            formattedAmount: formattedAmount
        };
        
    } catch (error) {
        console.error('❌ Token distribution failed:', error);
        
        // Extract more detailed error information
        let errorMessage = error?.message || 'Unknown error during token distribution';
        
        if (error?.logs) {
            console.error('📋 Transaction logs:', error.logs);
            errorMessage += ` | Logs: ${error.logs.join('; ')}`;
        }
        
        return {
            success: false,
            error: errorMessage,
            logs: error?.logs || null
        };
    }
}

// Scheduled ticker removed - using frontend-driven processing for instant response 