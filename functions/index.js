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
        roundDurationSec: configData.roundDurationSec || 8,
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
exports.joinLobby = functions.runWith({
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

        // Record payment in Firestore
        const paymentData = {
            playerAddress,
            transactionSignature,
            amount: config.entryFeeSol,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'confirmed'
        };
        
        await db.collection('payments').add(paymentData);

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
            responseTime: null // Will track button press timing
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
exports.cleanupOldGames = functions.runWith({
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

// Request Refund (only allowed in waiting/lobby states)
exports.requestRefund = functions.runWith({
    cors: true
}).https.onCall(async (data, context) => {
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
        
        // Only allow refunds in waiting/lobby states
        if (!['waiting', 'lobby'].includes(game.status)) {
            throw new functions.https.HttpsError('failed-precondition', 'Refunds not allowed - game has started or is full');
        }

        let players = game.players || {};
        const player = players[playerAddress];
        
        if (!player) {
            throw new functions.https.HttpsError('not-found', 'Player not found in game');
        }

        // Calculate refund amount (minus 0.0005 SOL transfer fee)
        const refundAmount = Math.max(0, player.solPaid - 0.0005);
        
        if (refundAmount <= 0) {
            throw new functions.https.HttpsError('failed-precondition', 'Refund amount too small after fees');
        }

        // Remove player from game
        delete players[playerAddress];
        const newPlayerCount = Object.keys(players).length;
        
        // Determine new game state
        let newStatus = game.status;
        let countdownStartedAt = game.countdownStartedAt;
        
        if (newPlayerCount === 0) {
            // No players left - game can be deleted or marked as cancelled
            newStatus = 'cancelled';
            countdownStartedAt = null;
        } else if (newPlayerCount === 1) {
            // Back to waiting for second player
            newStatus = 'waiting';
            countdownStartedAt = null;
        } else if (newPlayerCount >= 2) {
            // Reset countdown
            newStatus = 'lobby';
            countdownStartedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // Update game
        await gameRef.update({
            players: players,
            playerCount: newPlayerCount,
            status: newStatus,
            countdownStartedAt: countdownStartedAt,
            totalSolCollected: admin.firestore.FieldValue.increment(-player.solPaid),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Implement actual SOL refund transaction
        try {
            const connection = new Connection(config.rpcUrl, 'confirmed');
            const { Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
            
            // Create refund transaction
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
            
            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = fromPubkey;
            
            // Sign and send transaction
            transaction.sign(config.treasuryWallet);
            const signature = await connection.sendRawTransaction(transaction.serialize());
            
            // Wait for confirmation
            await connection.confirmTransaction(signature, 'confirmed');
            
            console.log(`💰 Refund sent: ${playerAddress} - ${refundAmount} SOL (${signature})`);
            
            // Record successful refund
            await db.collection('refunds').add({
                gameId: gameId,
                playerAddress: playerAddress,
                originalAmount: player.solPaid,
                refundAmount: refundAmount,
                transferFee: 0.0005,
                status: 'completed',
                transactionSignature: signature,
                requestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return { 
                success: true, 
                message: `Refund of ${refundAmount} SOL sent successfully!`,
                refundAmount: refundAmount,
                transactionSignature: signature,
                newPlayerCount: newPlayerCount,
                newStatus: newStatus
            };
            
        } catch (refundError) {
            console.error('❌ Refund transaction failed:', refundError);
            
            // Record failed refund but still remove player from game
            await db.collection('refunds').add({
                gameId: gameId,
                playerAddress: playerAddress,
                originalAmount: player.solPaid,
                refundAmount: refundAmount,
                transferFee: 0.0005,
                status: 'failed',
                error: refundError.message,
                requestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return { 
                success: true, 
                message: `Player removed from game, but refund transaction failed: ${refundError.message}`,
                refundAmount: 0,
                newPlayerCount: newPlayerCount,
                newStatus: newStatus,
                refundFailed: true
            };
        }

    } catch (error) {
        console.error('Refund request error:', error);
        throw new functions.https.HttpsError('internal', 'Refund request failed: ' + error.message);
    }
});

// Player Action with Response Time Tracking
exports.playerAction = functions.https.onCall(async (data, context) => {
    const { gameId, playerAddress, clientTimestamp } = data;
    
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

        // Calculate response time (time from round start to button press)
        const now = admin.firestore.Timestamp.now();
        const roundStartTime = game.roundStartedAt.toMillis();
        const responseTimeMs = now.toMillis() - roundStartTime;
        
        // Record player action with response time
        players[playerAddress] = {
            ...player,
            lastActionRound: game.round,
            lastActionAt: now,
            responseTime: responseTimeMs,
            clientTimestamp: clientTimestamp || null
        };

        console.log(`⚡ Player ${playerAddress} acted in round ${game.round} - Response time: ${responseTimeMs}ms`);

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

// Internal game processing function
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

    for (const doc of activeGames.docs) {
        const game = doc.data();
        const gameRef = doc.ref;
        
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
            
            if (elapsedSec >= config.roundDurationSec) {
                console.log(`⏰ Round ${game.round} timeout for game ${doc.id}`);
                
                let players = { ...game.players };
                
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
                
                // Eliminate players based on response time (slowest gets eliminated)
                if (alivePlayersWhoActed.length > 1) {
                    // Sort by response time (slowest first)
                    alivePlayersWhoActed.sort((a, b) => (b.responseTime || 0) - (a.responseTime || 0));
                    
                    // Eliminate the slowest player
                    const slowestPlayer = alivePlayersWhoActed[0];
                    players[slowestPlayer.address] = { ...slowestPlayer, status: 'eliminated' };
                    console.log(`🐌 Eliminated slowest player ${slowestPlayer.address} - Response time: ${slowestPlayer.responseTime}ms`);
                } else if (alivePlayersWhoDidntAct.length > 0) {
                    // Eliminate all players who didn't act
                    alivePlayersWhoDidntAct.forEach(player => {
                        players[player.address] = { ...player, status: 'eliminated' };
                        console.log(`💀 Eliminated ${player.address} for not acting in round ${game.round}`);
                    });
                }
                
                // Check for winner
                const alivePlayers = Object.values(players).filter(p => p.status === 'alive' && !p.isNpc);
                
                if (alivePlayers.length <= 1) {
                    // Game over - trigger Jupiter swap for winner
                    const winner = alivePlayers[0];
                    console.log(`🎉 Multiplayer game ${doc.id} complete! Winner: ${winner?.address || 'None'}`);
                    
                    let prizeData = null;
                    if (winner && game.totalSolCollected > 0) {
                        try {
                            // Perform Jupiter swap: SOL → BALL tokens
                            console.log(`🔄 Starting Jupiter swap: ${game.totalSolCollected} SOL → BALL tokens for ${winner.address}`);
                            const swapResult = await performJupiterSwap(config, game.totalSolCollected, winner.address);
                            
                            if (swapResult.success) {
                                // Transfer tokens to winner
                                const transferResult = await transferTokensToWinner(config, winner.address, parseInt(swapResult.outputAmount));
                                
                                // Jupiter returns the actual token amount (not in smallest units)
                                const actualTokenAmount = parseInt(swapResult.outputAmount);
                                const formattedAmount = (actualTokenAmount / Math.pow(10, config.prizeTokenDecimals)).toFixed(2);
                                
                                prizeData = {
                                    prizeAmountFormatted: parseFloat(formattedAmount).toLocaleString(),
                                    tokenSymbol: config.tokenSymbol,
                                    rawAmount: actualTokenAmount,
                                    solCollected: game.totalSolCollected,
                                    swapSignature: swapResult.signature,
                                    transferSignature: transferResult.signature || null,
                                    swapSuccess: true,
                                    transferSuccess: transferResult.success || false,
                                    jupiterQuoteAmount: swapResult.outputAmount // Store original for debugging
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
    }

    return { 
        success: true, 
        processedGames: processedGames,
        message: `Processed ${processedGames} games`
    };
}

// Fast Game Tick for Real-time Processing (HTTPS Callable)
// Fast Game Tick - Manual trigger
exports.fastGameTick = functions.https.onCall(async (data, context) => {
    try {
        return await processGameRounds();
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

// Scheduled ticker removed - using frontend-driven processing for instant response 