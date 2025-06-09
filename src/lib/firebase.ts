import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyA0_R4v9NirvhWZD9jmzCfYNi1H_s4bhDM",
  authDomain: "website-6889.firebaseapp.com",
  projectId: "website-6889",
  storageBucket: "website-6889.firebasestorage.app",
  messagingSenderId: "77825006993",
  appId: "1:77825006993:web:40a5ba80c8f319c89b7aa9",
  measurementId: "G-9K7WP7HPHC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Firebase Functions - properly configured
export const gameFunction = httpsCallable(functions, 'gameFunction'); 