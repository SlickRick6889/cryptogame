import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ============================================================================
// FIREBASE CONFIGURATION
// ============================================================================

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyATBlYvA_dZrQNSdC8F3v7mu8mFYZQAGes",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "website-6889.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "website-6889",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "website-6889.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "606064079207",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:606064079207:web:35dd32a23d0443a873ffc2",
};

// Initialize Firebase (singleton pattern)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// Export Firebase services
export const db = getFirestore(app);
export const functions = getFunctions(app);

// ============================================================================
// TYPE DEFINITIONS FOR FUNCTION CALLS
// ============================================================================

interface JoinLobbyRequest {
  playerAddress: string;
  transactionSignature?: string;
}

interface JoinLobbyResponse {
  success: boolean;
  requiresPayment?: boolean;
  entryFee?: number;
  treasuryAddress?: string;
  message?: string;
  gameId?: string;
  paymentVerified?: boolean;
  playerCount?: number;
  maxPlayers?: number;
  status?: string;
  isNewGame?: boolean;
  transactionSignature?: string;
}

interface PlayerActionRequest {
  gameId: string;
  playerAddress: string;
  clientTimestamp: number;
  clientResponseTime: number;
  roundStartTime: number;
  buttonAppearanceTime?: number;
}

interface PlayerActionResponse {
  success: boolean;
  message: string;
  round: number;
  responseTime: number;
}

interface RefundRequest {
  gameId: string;
  playerAddress: string;
}

interface RefundResponse {
  success: boolean;
  message: string;
  refundAmount?: number;
  refundSignature?: string;
  newPlayerCount?: number;
  newStatus?: string;
}

// ============================================================================
// CLEAN FUNCTION CALLS - Only Essential Functions
// ============================================================================

/**
 * Join a multiplayer game lobby
 * @param playerAddress - Solana wallet address
 * @param transactionSignature - Optional payment transaction signature
 * @returns Promise with join result
 */
export const callJoinLobby = (
  playerAddress: string, 
  transactionSignature?: string
) => {
  const fn = httpsCallable<JoinLobbyRequest, JoinLobbyResponse>(functions, 'joinLobby');
  return fn({ playerAddress, transactionSignature });
};

/**
 * Record a player's action (button click) for the current round
 * @param params - Action parameters including timing data
 * @returns Promise with action recording result
 */
export const callPlayerAction = (params: PlayerActionRequest) => {
  const fn = httpsCallable<PlayerActionRequest, PlayerActionResponse>(functions, 'playerAction');
  return fn(params);
};

/**
 * Request a refund for a player in a game that hasn't started
 * @param gameId - Game identifier
 * @param playerAddress - Player's wallet address
 * @returns Promise with refund result
 */
export const callRequestRefund = (gameId: string, playerAddress: string) => {
  const fn = httpsCallable<RefundRequest, RefundResponse>(functions, 'requestRefund');
  return fn({ gameId, playerAddress });
};

/**
 * Trigger game processing (replaces direct Firestore writes)
 * @param gameId - Game identifier to process
 * @returns Promise with trigger result
 */
export const callTriggerGameProcessing = (gameId: string) => {
  const fn = httpsCallable<{ gameId: string }, { success: boolean; message: string }>(functions, 'triggerGameProcessing');
  return fn({ gameId });
};

// ============================================================================
// REMOVED PROBLEMATIC FUNCTIONS
// ============================================================================


// REMOVED: callProcessGameRound - Frontend shouldn't trigger game processing
// 
// Why removed:
// - These functions caused conflicts between frontend and backend game processing
// - Backend now handles all game logic automatically via scheduled functions
// - Frontend only needs to display state and send player actions
// - Real-time updates come through Firestore listeners, not manual triggers

// ============================================================================
// UTILITY FUNCTIONS (Optional - for debugging/admin)
// ============================================================================

/**
 * Get game analytics (admin function)
 * NOTE: Only call this from admin interfaces, not from game UI
 */
export const callGetPaymentAnalytics = (limit: number = 50) => {
  const fn = httpsCallable<{ limit: number }, any>(functions, 'getPaymentAnalytics');
  return fn({ limit });
};

/**
 * Clean up old completed games (admin function)
 * NOTE: Only call this from admin interfaces
 */
export const callCleanupOldGames = (olderThanHours: number = 24) => {
  const fn = httpsCallable<{ olderThanHours: number }, any>(functions, 'cleanupOldGames');
  return fn({ olderThanHours });
};

// ============================================================================
// FIREBASE CONFIGURATION HELPERS
// ============================================================================

/**
 * Get the current Firebase project ID
 */
export const getProjectId = (): string => {
  return firebaseConfig.projectId;
};

/**
 * Check if Firebase is properly initialized
 */
export const isFirebaseInitialized = (): boolean => {
  return getApps().length > 0;
};

/**
 * Get Firebase app instance
 */
export const getFirebaseApp = () => {
  return app;
};

// ============================================================================
// ERROR HANDLING HELPER
// ============================================================================

/**
 * Helper function to handle Firebase function call errors
 * @param error - Error from Firebase function call
 * @returns User-friendly error message
 */
export const handleFirebaseError = (error: any): string => {
  if (error?.code) {
    switch (error.code) {
      case 'functions/not-found':
        return 'Game function not found. Please refresh and try again.';
      case 'functions/permission-denied':
        return 'Permission denied. Please check your connection.';
      case 'functions/deadline-exceeded':
        return 'Request timed out. Please try again.';
      case 'functions/unavailable':
        return 'Game service temporarily unavailable. Please try again.';
      case 'functions/invalid-argument':
        return error.message || 'Invalid request. Please check your input.';
      case 'functions/failed-precondition':
        return error.message || 'Game state error. Please refresh and try again.';
      case 'functions/already-exists':
        return error.message || 'You are already in this game.';
      default:
        return error.message || 'An unexpected error occurred. Please try again.';
    }
  }
  
  return error?.message || 'Network error. Please check your connection and try again.';
};

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/*
✅ EXPORTED FUNCTIONS (Clean & Essential):
- callJoinLobby: Join games and handle payments
- callPlayerAction: Record button clicks/actions
- callRequestRefund: Request refunds for unstarted games
- callGetPaymentAnalytics: Admin analytics (optional)
- callCleanupOldGames: Admin cleanup (optional)

❌ REMOVED FUNCTIONS (Caused Race Conditions):

- callProcessGameRound: Frontend game logic processing

🎯 ARCHITECTURE:
Frontend: Display state, send actions, handle payments
Backend: Process all game logic automatically
Real-time: Firestore listeners for instant UI updates
*/