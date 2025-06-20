const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { 
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction,
    LAMPORTS_PER_SOL,
    SystemProgram
} = require('@solana/web3.js');
const { 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    createTransferInstruction
} = require('@solana/spl-token');

let bs58;
try {
    bs58 = require('bs58');
    if (typeof bs58.decode !== 'function') {
        bs58 = bs58.default || bs58;
    }
} catch (error) {
    console.error('Failed to import bs58:', error);
    throw new Error('bs58 module not available');
}

const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// CORS configuration for all functions
const corsOptions = {
    cors: {
        origin: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }
};

// Game configuration
async function getGameConfig() {
    const configDoc = await db.collection('config').doc('game').get();
    if (!configDoc.exists) throw new Error('Game configuration not found');
    
    const configData = configDoc.data() || {};
    
    // Get private key securely
    let privateKey;
    try {
        privateKey = functions.config().treasury?.pk || process.env.TREASURY_PK;
    } catch (error) {
        privateKey = process.env.TREASURY_PK;
    }
    
    if (!privateKey) {
        throw new Error('Treasury private key not configured');
    }

    let treasuryWallet;
    try {
        const secretKeyBytes = bs58.decode(privateKey);
        treasuryWallet = Keypair.fromSecretKey(secretKeyBytes);
    } catch (error) {
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
        maxPlayersPerGame: configData.maxPlayersPerGame || 5,
        roundDurationSec: configData.roundDurationSec || 5,
        tokenSymbol: configData.tokenSymbol,
        prizeTokenDecimals: configData.prizeTokenDecimals || 6
    };
}

// Sequential ID generators
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

async function getNextPaymentId() {
    const counterRef = db.collection('counters').doc('paymentCounter');
    return db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let nextNumber = 1;
        if (counterDoc.exists) {
            nextNumber = (counterDoc.data().count || 0) + 1;
        }
        transaction.set(counterRef, { count: nextNumber }, { merge: true });
        return `payment${nextNumber}`;
    });
}

// ============================================================================
// MAIN GAME FUNCTIONS - These match what the React component expects
// ============================================================================

// 1. JOIN LOBBY - Main entry point for players
exports.joinLobby = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    const { playerAddress, transactionSignature } = data;
    
    if (!playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Player address required');
    }

    try {
        const config = await getGameConfig();
        const connection = new Connection(config.rpcUrl, 'confirmed');
        
        console.log(`🎮 Player ${playerAddress} attempting to join lobby`);

        // STEP 1: Verify payment if signature provided
        if (transactionSignature) {
            console.log(`💰 Verifying payment: ${transactionSignature}`);
            
            const transaction = await connection.getTransaction(transactionSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (!transaction || transaction.meta?.err) {
                throw new functions.https.HttpsError('invalid-argument', 'Transaction not found or failed');
            }
            
            // Verify payment amount to treasury
            const expectedLamports = Math.floor(config.entryFeeSol * LAMPORTS_PER_SOL);
            const treasuryPubkey = config.treasuryWallet.publicKey;
            const accountKeys = transaction.transaction.message.staticAccountKeys || 
                              transaction.transaction.message.accountKeys;
            
            const treasuryIndex = accountKeys.findIndex(key => key.equals(treasuryPubkey));
            
            if (treasuryIndex === -1 || !transaction.meta?.preBalances || !transaction.meta?.postBalances) {
                throw new functions.https.HttpsError('invalid-argument', 'Payment verification failed');
            }
            
            const balanceChange = transaction.meta.postBalances[treasuryIndex] - transaction.meta.preBalances[treasuryIndex];
            
            if (balanceChange < expectedLamports * 0.95) { // 5% tolerance for fees
                throw new functions.https.HttpsError('invalid-argument', 'Insufficient payment amount');
            }
            
            console.log(`✅ Payment verified: ${balanceChange} lamports`);
            
            // Record payment
            const paymentId = await getNextPaymentId();
            await db.collection('payments').doc(paymentId).set({
                paymentId,
                playerAddress,
                transactionSignature,
                amount: config.entryFeeSol,
                amountLamports: balanceChange,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'confirmed',
                network: config.network,
                treasuryAddress: config.treasuryWallet.publicKey.toString()
            });
        } else {
            // STEP 1 ALT: Check balance and return payment requirement
            const playerPubkey = new PublicKey(playerAddress);
            const balance = await connection.getBalance(playerPubkey);
            const solBalance = balance / LAMPORTS_PER_SOL;

            if (solBalance < config.entryFeeSol) {
                throw new functions.https.HttpsError('failed-precondition', 
                    `Insufficient SOL balance. Need ${config.entryFeeSol} SOL, have ${solBalance.toFixed(4)} SOL`);
            }
            
            return {
                success: false,
                requiresPayment: true,
                entryFee: config.entryFeeSol,
                treasuryAddress: config.treasuryWallet.publicKey.toString(),
                message: `Please send ${config.entryFeeSol} SOL to join the game`
            };
        }

        // STEP 2: Check for existing active games
        const playerGamesQuery = db.collection('games')
            .where('status', 'in', ['lobby', 'starting', 'in_progress']);
        
        const playerGames = await playerGamesQuery.get();
        for (const doc of playerGames.docs) {
            const gameData = doc.data();
            if (gameData.players && gameData.players[playerAddress]) {
                const gameAge = Date.now() - (gameData.createdAt?.toDate?.()?.getTime() || 0);
                if (gameAge < 15 * 60 * 1000) { // 15 minutes
                    throw new functions.https.HttpsError('already-exists', 
                        `You are already in game: ${doc.id}. Please finish or leave that game first.`);
                }
            }
        }

        // STEP 3: Find or create game
        const existingLobbyQuery = db.collection('games')
            .where('status', 'in', ['waiting', 'lobby'])
            .orderBy('createdAt', 'asc')
            .limit(5);
        
        const existingLobbies = await existingLobbyQuery.get();
        const availableLobbies = existingLobbies.docs.filter(doc => {
            const gameData = doc.data();
            return (gameData.playerCount || 0) < config.maxPlayersPerGame;
        });

        let gameRef;
        let isNewGame = false;
        
        if (availableLobbies.length > 0) {
            gameRef = availableLobbies[0].ref;
        } else {
            const gameId = await getNextGameId();
            gameRef = db.collection('games').doc(gameId);
            isNewGame = true;
        }

        // STEP 4: Add player to game (atomic transaction)
        const result = await db.runTransaction(async (transaction) => {
            const gameDoc = isNewGame ? null : await transaction.get(gameRef);
            
            if (!isNewGame && (!gameDoc || !gameDoc.exists)) {
                throw new functions.https.HttpsError('not-found', 'Game no longer exists');
            }
            
            const currentGameData = isNewGame ? null : gameDoc.data();
            let players = currentGameData?.players || {};

            if (players[playerAddress]) {
                throw new functions.https.HttpsError('already-exists', 'Player already in this game');
            }

            if (Object.keys(players).length >= config.maxPlayersPerGame) {
                throw new functions.https.HttpsError('failed-precondition', 'Game is full');
            }

            // Add player
            players[playerAddress] = {
                address: playerAddress,
                name: `Player ${playerAddress.slice(0, 4)}`,
                status: 'alive',
                isNpc: false,
                lastActionRound: 0,
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                solPaid: config.entryFeeSol,
                transactionSignature: transactionSignature,
                responseTime: null,
                refundRequested: false
            };

            const playerCount = Object.keys(players).length;
            let newStatus = 'waiting';
            let countdownStartedAt = null;
            let message = '';

            // Determine game status
            if (playerCount === 1) {
                newStatus = 'waiting';
                message = 'Waiting for more players...';
            } else if (playerCount >= 2 && playerCount < config.maxPlayersPerGame) {
                newStatus = 'lobby';
                countdownStartedAt = admin.firestore.FieldValue.serverTimestamp();
                message = `Game will start in 15 seconds with ${playerCount}/${config.maxPlayersPerGame} players.`;
            } else if (playerCount >= config.maxPlayersPerGame) {
                newStatus = 'in_progress';
                message = 'Game is full! Starting now.';
            }

            const updateData = {
                players: players,
                playerCount: playerCount,
                status: newStatus,
                totalSolCollected: isNewGame ? config.entryFeeSol : admin.firestore.FieldValue.increment(config.entryFeeSol),
                payments: admin.firestore.FieldValue.arrayUnion({
                    player: playerAddress,
                    signature: transactionSignature,
                    amount: config.entryFeeSol
                }),
                countdownStartedAt: countdownStartedAt,
                countdownDuration: 15,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // If starting immediately, add game start fields
            if (newStatus === 'in_progress') {
                Object.assign(updateData, {
                    round: 1,
                    roundStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                    roundDurationSec: config.roundDurationSec,
                    swappingInProgress: true,
                    prizeTokensReady: false
                });
            }

            // Set creation fields for new games
            if (isNewGame) {
                Object.assign(updateData, {
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    entryFeeSol: config.entryFeeSol,
                    ballTokenMint: config.ballTokenMint,
                    tokenSymbol: config.tokenSymbol,
                    maxPlayers: config.maxPlayersPerGame
                });
                transaction.set(gameRef, updateData);
            } else {
                transaction.update(gameRef, updateData);
            }

            return { 
                success: true, 
                gameId: gameRef.id,
                message: message,
                entryFee: config.entryFeeSol,
                paymentVerified: true,
                playerCount: playerCount,
                maxPlayers: config.maxPlayersPerGame,
                status: newStatus,
                isNewGame: isNewGame,
                transactionSignature: transactionSignature
            };
        });

        // STEP 5: Start token swap if game is starting
        if (result.status === 'in_progress') {
            console.log(`🔄 Game ${result.gameId} starting - initiating token swap`);
            // Start swap asynchronously (don't await)
            performTokenSwap(config, result.gameId, config.entryFeeSol * result.playerCount)
                .catch(error => console.error(`Swap failed for game ${result.gameId}:`, error));
        }

        return result;

    } catch (error) {
        console.error('Join lobby error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to join lobby: ' + error.message);
    }
});

// 2. PLAYER ACTION - Record player responses
exports.playerAction = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    const { gameId, playerAddress, clientResponseTime, clientTimestamp } = data;
    
    if (!gameId || !playerAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID and player address required');
    }

    try {
        // Use atomic transaction to prevent race conditions
        return await db.runTransaction(async (transaction) => {
            const gameRef = db.collection('games').doc(gameId);
            const gameDoc = await transaction.get(gameRef);
            
            if (!gameDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Game not found');
            }

            const game = gameDoc.data();
            if (game.status !== 'in_progress') {
                throw new functions.https.HttpsError('failed-precondition', 
                    `Game not in progress (status: ${game.status})`);
            }

            let players = game.players || {};
            const player = players[playerAddress];
            
            if (!player || player.status !== 'alive') {
                throw new functions.https.HttpsError('failed-precondition', 'Player not alive');
            }

            const now = admin.firestore.Timestamp.now();
            const responseTime = clientResponseTime || (now.toMillis() - game.roundStartedAt.toMillis());
            
            // Update player atomically
            players[playerAddress] = {
                ...player,
                lastActionRound: game.round,
                lastActionAt: now,
                responseTime: responseTime,
                clientTimestamp: clientTimestamp
            };

            transaction.update(gameRef, {
                players: players,
                updatedAt: now
            });

            console.log(`✅ Player action recorded: ${playerAddress} responded in ${responseTime}ms`);

            return { 
                success: true, 
                message: 'Action recorded',
                round: game.round,
                responseTime: responseTime
            };
        });

    } catch (error) {
        console.error('Player action error:', error);
        throw new functions.https.HttpsError('internal', 'Action failed: ' + error.message);
    }
});

// 3. REQUEST REFUND - Handle refund requests
exports.requestRefund = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
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
        
        if (!['waiting', 'lobby'].includes(game.status)) {
            throw new functions.https.HttpsError('failed-precondition', 
                'Refunds not allowed - game has already started');
        }

        let players = game.players || {};
        const player = players[playerAddress];
        
        if (!player) {
            throw new functions.https.HttpsError('not-found', 'Player not found in game');
        }

        if (player.refundRequested) {
            throw new functions.https.HttpsError('already-exists', 
                'Refund already requested for this player');
        }

        // Calculate refund amount (minus transfer fee)
        const refundAmount = player.solPaid - 0.0005;
        
        if (refundAmount <= 0) {
            throw new functions.https.HttpsError('failed-precondition', 
                'Refund amount too small after transfer fee');
        }

        // Send refund transaction
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);
        const fromPubkey = config.treasuryWallet.publicKey;
        const toPubkey = new PublicKey(playerAddress);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({ fromPubkey, toPubkey, lamports: refundLamports })
        );
        
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromPubkey;
        
        transaction.sign(config.treasuryWallet);
        const refundSignature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(refundSignature, 'confirmed');

        // Remove player from game
        delete players[playerAddress];
        const newPlayerCount = Object.keys(players).length;
        
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
            countdownStartedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await gameRef.update({
            players: players,
            playerCount: newPlayerCount,
            status: newStatus,
            countdownStartedAt: countdownStartedAt,
            totalSolCollected: admin.firestore.FieldValue.increment(-player.solPaid),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`💰 Refund processed: ${refundAmount} SOL to ${playerAddress}`);

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

// ============================================================================
// GAME PROCESSING - Single unified processor
// ============================================================================

// 4. PROCESS GAME ROUND - Main game logic processor
exports.processGameRound = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    const { gameId } = data;
    if (!gameId) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID required');
    }

    try {
        const result = await processGame(gameId);
        return result;
    } catch (error) {
        console.error(`❌ Game processing failed for ${gameId}:`, error);
        throw new functions.https.HttpsError('internal', `Processing failed: ${error.message}`);
    }
});

// Core game processing logic
async function processGame(gameId) {
    const config = await getGameConfig();
    const now = admin.firestore.Timestamp.now();
    const gameRef = db.collection('games').doc(gameId);
    const gameDoc = await gameRef.get();
    
    if (!gameDoc.exists) {
        return { success: false, error: 'Game not found' };
    }
    
    const game = gameDoc.data();
    
    console.log(`🎮 Processing game ${gameId} - Status: ${game.status}, Round: ${game.round || 0}`);
    
    switch (game.status) {
        case 'lobby':
            return await checkLobbyCountdown(gameRef, game, config, now);
        case 'in_progress':
            return await processRound(gameRef, game, config, now);
        default:
            return { success: true, message: `No processing needed for status: ${game.status}` };
    }
}

// Check if lobby countdown has expired
async function checkLobbyCountdown(gameRef, game, config, now) {
    if (!game.countdownStartedAt) {
        return { success: true, message: 'No countdown active' };
    }
    
    const elapsed = (now.toMillis() - game.countdownStartedAt.toMillis()) / 1000;
    const duration = game.countdownDuration || 15;
    
    if (elapsed >= duration) {
        console.log(`⏰ Lobby countdown expired for ${gameRef.id} - starting game`);
        
        await gameRef.update({
            status: 'in_progress',
            round: 1,
            roundStartedAt: now,
            roundDurationSec: config.roundDurationSec,
            updatedAt: now,
            swappingInProgress: true,
            prizeTokensReady: false,
            countdownStartedAt: null
        });
        
        // Start token swap asynchronously
        performTokenSwap(config, gameRef.id, game.totalSolCollected)
            .catch(error => console.error(`Swap failed for game ${gameRef.id}:`, error));
        
        return { success: true, message: 'Game started', status: 'in_progress', round: 1 };
    }
    
    return { success: true, message: `Countdown active: ${elapsed.toFixed(1)}s / ${duration}s` };
}

// Process current round
async function processRound(gameRef, game, config, now) {
    if (!game.roundStartedAt) {
        return { success: false, error: 'No round start time' };
    }
    
    const elapsed = (now.toMillis() - game.roundStartedAt.toMillis()) / 1000;
    const roundDuration = game.roundDurationSec || config.roundDurationSec || 5;
    
    // Add 1 second buffer for network delays
    if (elapsed < (roundDuration + 1)) {
        return { 
            success: false, 
            error: `Round not expired: ${elapsed.toFixed(1)}s < ${roundDuration + 1}s` 
        };
    }
    
    console.log(`⏰ Processing round ${game.round} elimination - elapsed: ${elapsed.toFixed(1)}s`);
    
    const players = { ...game.players };
    
    // Find who acted this round
    const acted = Object.values(players).filter(p => 
        p.status === 'alive' && p.lastActionRound === game.round && !p.isNpc
    );
    const didntAct = Object.values(players).filter(p => 
        p.status === 'alive' && p.lastActionRound < game.round && !p.isNpc
    );
    
    console.log(`📊 Round ${game.round}: ${acted.length} acted, ${didntAct.length} didn't act`);
    
    // Elimination logic
    if (acted.length > 1) {
        // Multiple players acted - eliminate slowest
        acted.sort((a, b) => (b.responseTime || 0) - (a.responseTime || 0));
        const slowest = acted[0];
        players[slowest.address] = { ...slowest, status: 'eliminated' };
        console.log(`❌ Eliminated slowest responder: ${slowest.address} (${slowest.responseTime}ms)`);
    } else if (acted.length === 1) {
        // Only one player acted - eliminate all who didn't act
        didntAct.forEach(p => {
            players[p.address] = { ...p, status: 'eliminated' };
            console.log(`❌ Eliminated non-responder: ${p.address}`);
        });
    } else if (didntAct.length >= 2) {
        // Nobody acted - eliminate random player except one
        const shuffled = [...didntAct].sort(() => Math.random() - 0.5);
        shuffled.slice(1).forEach(p => {
            players[p.address] = { ...p, status: 'eliminated' };
            console.log(`❌ Eliminated random non-responder: ${p.address}`);
        });
    }
    
    // Check if game is complete
    const alive = Object.values(players).filter(p => p.status === 'alive' && !p.isNpc);
    
    if (alive.length <= 1) {
        // Game complete!
        const winner = alive[0];
        
        console.log(`🏆 Game ${gameRef.id} complete! Winner: ${winner?.address || 'None'}`);
        
        await gameRef.update({
            status: 'completed',
            winner: winner?.address || null,
            players,
            completedAt: now,
            updatedAt: now,
            prize: winner ? { status: 'Processing prize...', processing: true } : null
        });
        
        // Process prize immediately if there's a winner
        if (winner) {
            processPrize(gameRef.id, winner.address, game, config)
                .catch(error => console.error(`Prize processing failed for ${gameRef.id}:`, error));
        }
        
        return { 
            success: true, 
            gameCompleted: true, 
            winner: winner?.address,
            alivePlayers: alive.length 
        };
    } else {
        // Continue to next round
        console.log(`🔄 Round ${game.round} complete - ${alive.length} players remaining`);
        
        // Reset response times for next round
        Object.keys(players).forEach(addr => {
            if (players[addr].status === 'alive') {
                players[addr] = { ...players[addr], responseTime: null };
            }
        });
        
        await gameRef.update({
            round: game.round + 1,
            roundStartedAt: now,
            players,
            updatedAt: now
        });
        
        return { 
            success: true, 
            nextRound: game.round + 1, 
            alivePlayers: alive.length 
        };
    }
}

// ============================================================================
// TOKEN SWAP & PRIZE PROCESSING
// ============================================================================

// Unified token swap function
async function performTokenSwap(config, gameId, solAmount) {
    const swapStartTime = Date.now();
    
    try {
        console.log(`🔄 Starting token swap for game ${gameId}: ${solAmount} SOL → ${config.tokenSymbol}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        // Get Jupiter quote
        const quoteParams = new URLSearchParams({
            inputMint: 'So11111111111111111111111111111111111111112', // SOL
            outputMint: config.ballTokenMint,
            amount: lamports.toString(),
            slippageBps: '300' // 3% slippage
        });
        
        const quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote?${quoteParams}`, {
            timeout: 15000
        });
        
        const quote = quoteResponse.data;
        console.log(`📊 Quote: ${quote.inAmount} lamports → ${quote.outAmount} tokens`);
        
        // Get swap transaction
        const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: config.treasuryWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: { 
                priorityLevelWithMaxLamports: { 
                    maxLamports: 10000000,
                    priorityLevel: "veryHigh"
                } 
            }
        }, { 
            timeout: 20000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        // Sign and send transaction
        const transactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([config.treasuryWallet]);
        
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            maxRetries: 5
        });
        
        // Confirm transaction
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        const duration = Date.now() - swapStartTime;
        console.log(`✅ Token swap completed in ${duration}ms: ${signature}`);
        
        // Update game with ready tokens
        const gameRef = db.collection('games').doc(gameId);
        await gameRef.update({
            prizeTokensReady: true,
            swappingInProgress: false,
            swappedTokenAmount: parseInt(quote.outAmount),
            swapSignature: signature,
            swapCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { 
            success: true, 
            signature, 
            tokenAmount: parseInt(quote.outAmount),
            duration 
        };
        
    } catch (error) {
        const duration = Date.now() - swapStartTime;
        console.error(`❌ Token swap failed for game ${gameId} after ${duration}ms:`, error.message);
        
        // Update game with failure
        const gameRef = db.collection('games').doc(gameId);
        await gameRef.update({
            prizeTokensReady: false,
            swappingInProgress: false,
            swapError: error.message,
            swapFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { success: false, error: error.message, duration };
    }
}

// Prize processing
async function processPrize(gameId, winnerAddress, game, config) {
    try {
        console.log(`🏆 Processing prize for winner ${winnerAddress} in game ${gameId}`);
        
        const gameRef = db.collection('games').doc(gameId);
        let transferResult;
        
        if (game.prizeTokensReady && game.swappedTokenAmount) {
            // Use pre-swapped tokens
            console.log(`⚡ Using pre-swapped tokens: ${game.swappedTokenAmount}`);
            transferResult = await transferTokens(config, winnerAddress, game.swappedTokenAmount);
        } else {
            // Swap then transfer
            console.log(`🔄 Swapping tokens for prize...`);
            const swapResult = await performJupiterSwap(config, game.totalSolCollected);
            
            if (swapResult.success) {
                transferResult = await transferTokens(config, winnerAddress, parseInt(swapResult.outputAmount));
            } else {
                throw new Error(`Swap failed: ${swapResult.error}`);
            }
        }
        
        // Calculate display amount
        const decimals = config.prizeTokenDecimals || 6;
        const amount = (transferResult.tokenAmount || game.swappedTokenAmount) / Math.pow(10, decimals);
        
        await gameRef.update({
            prize: {
                prizeAmountFormatted: amount.toLocaleString('en-US', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                }),
                tokenSymbol: config.tokenSymbol,
                rawAmount: transferResult.tokenAmount || game.swappedTokenAmount,
                solCollected: game.totalSolCollected,
                transferSignature: transferResult.signature,
                transferSuccess: transferResult.success,
                processing: false,
                status: transferResult.success ? '🎉 Prize sent successfully!' : `Failed: ${transferResult.error}`,
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });
        
        console.log(`✅ Prize processing complete: ${amount.toFixed(2)} ${config.tokenSymbol}`);
        
    } catch (error) {
        console.error(`❌ Prize processing failed for ${gameId}:`, error);
        
        const gameRef = db.collection('games').doc(gameId);
        await gameRef.update({
            prize: { 
                processing: false, 
                error: error.message, 
                status: `Failed: ${error.message}`,
                failedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });
    }
}

// Token transfer function
async function transferTokens(config, winnerAddress, tokenAmount) {
    try {
        console.log(`💸 Transferring ${tokenAmount} tokens to ${winnerAddress}`);
        
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const winnerPubkey = new PublicKey(winnerAddress);
        const tokenMint = new PublicKey(config.ballTokenMint);
        
        const [treasuryATA, winnerATA] = await Promise.all([
            getAssociatedTokenAddress(tokenMint, config.treasuryWallet.publicKey),
            getAssociatedTokenAddress(tokenMint, winnerPubkey)
        ]);
        
        const instructions = [];
        
        // Check if winner's ATA exists
        const accountInfo = await connection.getAccountInfo(winnerATA);
        if (!accountInfo) {
            instructions.push(createAssociatedTokenAccountInstruction(
                config.treasuryWallet.publicKey, 
                winnerATA, 
                winnerPubkey, 
                tokenMint
            ));
        }
        
        // Add transfer instruction
        instructions.push(createTransferInstruction(
            treasuryATA, 
            winnerATA, 
            config.treasuryWallet.publicKey, 
            tokenAmount
        ));
        
        // Build and send transaction
        const transaction = new Transaction().add(...instructions);
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = config.treasuryWallet.publicKey;
        transaction.sign(config.treasuryWallet);
        
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });
        
        await connection.confirmTransaction(signature, 'confirmed');
        
        console.log(`✅ Token transfer successful: ${signature}`);
        
        return { 
            success: true, 
            signature, 
            tokenAmount 
        };
        
    } catch (error) {
        console.error(`❌ Token transfer failed:`, error);
        return { 
            success: false, 
            error: error.message 
        };
    }
}

// Fallback Jupiter swap for prizes
async function performJupiterSwap(config, solAmount) {
    try {
        const connection = new Connection(config.rpcUrl, 'confirmed');
        const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
        
        const quoteParams = new URLSearchParams({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: config.ballTokenMint,
            amount: lamports.toString(),
            slippageBps: '300'
        });
        
        const quoteResponse = await axios.get(`https://quote-api.jup.ag/v6/quote?${quoteParams}`, {
            timeout: 10000
        });
        
        const quote = quoteResponse.data;
        
        const swapResponse = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: config.treasuryWallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        }, { timeout: 15000 });
        
        const transactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([config.treasuryWallet]);
        
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });
        
        await connection.confirmTransaction(signature);
        
        return {
            success: true,
            signature,
            outputAmount: quote.outAmount
        };
        
    } catch (error) {
        console.error('❌ Jupiter swap failed:', error);
        return {
            success: false,
            error: error?.message || 'Unknown error during Jupiter swap'
        };
    }
}

// ============================================================================
// FIRESTORE TRIGGERS - Instant Response to Game Changes
// ============================================================================

// Real-time game processing trigger - responds instantly to game document changes
exports.onGameChange = functions.region('us-central1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('games/{gameId}')
    .onWrite(async (change, context) => {
        const gameId = context.params.gameId;
        
        // Skip if document was deleted
        if (!change.after.exists) {
            console.log(`🗑️ Game ${gameId} was deleted`);
            return;
        }
        
        const gameData = change.after.data();
        const previousData = change.before.exists ? change.before.data() : null;
        
        // Only process if status changed or trigger flag is set
        const statusChanged = !previousData || previousData.status !== gameData.status;
        const triggerProcessing = gameData.triggerProcessing === true;
        
        if (!statusChanged && !triggerProcessing) {
            return; // No processing needed
        }
        
        console.log(`🔄 Game ${gameId} trigger - Status: ${gameData.status}, Trigger: ${triggerProcessing}`);
        
        try {
            // Clear the trigger flag first to prevent loops
            if (triggerProcessing) {
                await change.after.ref.update({
                    triggerProcessing: admin.firestore.FieldValue.delete()
                });
            }
            
            // Process the game
            await processGame(gameId);
            console.log(`✅ Game ${gameId} processed successfully`);
            
        } catch (error) {
            console.error(`❌ Failed to process game ${gameId}:`, error);
            
            // Update game with error status
            await change.after.ref.update({
                statusMessage: `Processing error: ${error.message}`,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });

// ============================================================================
// SCHEDULED FUNCTIONS - Backup Only (Every 5 Minutes)
// ============================================================================

// Backup scheduled processing for stuck games only
exports.scheduledGameProcessing = functions.region('us-central1')
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .pubsub.schedule('every 5 minutes')
    .timeZone('America/New_York')
    .onRun(async (context) => {
        console.log('⏰ Backup scheduled processing - checking for stuck games');
        
        try {
            // Only process games that are truly stuck (older than 5 minutes with no updates)
            const fiveMinutesAgo = new Date(Date.now() - 300000);
            
            const stuckGamesQuery = db.collection('games')
                .where('status', 'in', ['lobby', 'in_progress'])
                .where('updatedAt', '<', fiveMinutesAgo)
                .limit(3);
            
            const stuckGames = await stuckGamesQuery.get();

            if (stuckGames.empty) {
                console.log('✅ No stuck games found');
                return { success: true, message: 'No stuck games' };
            }

            console.log(`🔧 Processing ${stuckGames.size} truly stuck games`);
            
            let processed = 0;
            for (const doc of stuckGames.docs) {
                try {
                    await processGame(doc.id);
                    processed++;
                    console.log(`✅ Processed stuck game: ${doc.id}`);
                } catch (error) {
                    console.error(`❌ Failed to process stuck game ${doc.id}:`, error);
                }
            }
            
            return { success: true, processedGames: processed };
            
        } catch (error) {
            console.error('❌ Scheduled processing failed:', error);
            return { success: false, error: error.message };
        }
    });

// ============================================================================
// DEPRECATED FUNCTIONS (For Cached Code Compatibility)
// ============================================================================

// Deprecated function to handle cached frontend calls
exports.fastGameTick = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    console.log('⚠️ fastGameTick called - this function has been deprecated');
    throw new functions.https.HttpsError('failed-precondition', 
        'fastGameTick has been deprecated. Game processing now happens automatically. Please refresh your browser and clear cache.');
});

// New function to trigger game processing (replaces direct Firestore writes)
exports.triggerGameProcessing = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    const { gameId } = data;
    
    if (!gameId) {
        throw new functions.https.HttpsError('invalid-argument', 'Game ID required');
    }
    
    try {
        console.log(`🔄 Manual trigger requested for game: ${gameId}`);
        
        // Update the game document to trigger the Firestore listener
        const gameRef = db.collection('games').doc(gameId);
        await gameRef.update({
            triggerProcessing: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Game ${gameId} processing triggered successfully`);
        
        return {
            success: true,
            message: `Game ${gameId} processing triggered`
        };
        
    } catch (error) {
        console.error(`❌ Failed to trigger game ${gameId}:`, error);
        throw new functions.https.HttpsError('internal', `Failed to trigger game processing: ${error.message}`);
    }
});

// ============================================================================
// ADMIN & UTILITY FUNCTIONS
// ============================================================================

// Clean up old games
exports.cleanupOldGames = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    try {
        const { olderThanHours = 24 } = data;
        const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
        
        const oldGamesQuery = db.collection('games')
            .where('status', 'in', ['completed', 'cancelled'])
            .where('updatedAt', '<', cutoffTime)
            .limit(50);
        
        const oldGames = await oldGamesQuery.get();
        
        if (oldGames.empty) {
            return { success: true, message: 'No old games to clean' };
        }
        
        const batch = db.batch();
        oldGames.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        console.log(`🧹 Cleaned up ${oldGames.size} old games`);
        
        return { 
            success: true, 
            cleanedGames: oldGames.size,
            message: `Cleaned up ${oldGames.size} old games`
        };
        
    } catch (error) {
        console.error('❌ Cleanup error:', error);
        throw new functions.https.HttpsError('internal', `Cleanup failed: ${error.message}`);
    }
});

// Get payment analytics
exports.getPaymentAnalytics = functions.region('us-central1').runWith(corsOptions).https.onCall(async (data, context) => {
    try {
        const { limit = 50 } = data;
        
        const paymentsQuery = db.collection('payments')
            .orderBy('timestamp', 'desc')
            .limit(limit);
        
        const paymentsSnapshot = await paymentsQuery.get();
        const payments = [];
        let totalAmount = 0;
        let successfulPayments = 0;
        
        paymentsSnapshot.forEach(doc => {
            const payment = { id: doc.id, ...doc.data() };
            payments.push(payment);
            
            if (payment.status === 'confirmed') {
                totalAmount += payment.amount || 0;
                successfulPayments++;
            }
        });
        
        const analytics = {
            totalPayments: payments.length,
            successfulPayments,
            totalAmountSOL: totalAmount,
            averagePayment: successfulPayments > 0 ? totalAmount / successfulPayments : 0,
            successRate: payments.length > 0 ? (successfulPayments / payments.length * 100).toFixed(2) : 0
        };
        
        return {
            success: true,
            analytics,
            payments: payments.slice(0, 20),
            message: `Retrieved ${payments.length} payments`
        };
        
    } catch (error) {
        console.error('❌ Payment analytics error:', error);
        throw new functions.https.HttpsError('internal', `Failed to get payment analytics: ${error.message}`);
    }
});