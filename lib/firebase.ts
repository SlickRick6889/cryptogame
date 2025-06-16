import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const functions = getFunctions(app);

// Trigger fast game tick
export const callFastGameTick = () => {
  const fn = httpsCallable<{}, any>(functions, 'fastGameTick');
  return fn({});
};

// Join multiplayer lobby
export const callJoinLobby = (playerAddress: string, transactionSignature?: string) => {
  const fn = httpsCallable<{ playerAddress: string; transactionSignature?: string }, any>(functions, 'joinLobby');
  return fn({ playerAddress, transactionSignature });
};

// Record player action
export const callPlayerAction = (params: {
  gameId: string;
  playerAddress: string;
  clientTimestamp: number;
  clientResponseTime: number;
  roundStartTime: number;
}) => {
  const fn = httpsCallable<typeof params, any>(functions, 'playerAction');
  return fn(params);
};

// Request refund
export const callRequestRefund = (gameId: string, playerAddress: string) => {
  const fn = httpsCallable<{ gameId: string; playerAddress: string }, any>(functions, 'requestRefund');
  return fn({ gameId, playerAddress });
}; 