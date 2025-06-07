# 🚀 STAYPOOL Automated Token Purchase Setup

## 🎯 How It Works

1. **Player connects wallet** → Pays SOL entry fee to your DEV wallet
2. **Firebase monitors your DEV wallet** → Detects new SOL payments
3. **Auto-purchases STAY tokens** → Uses Jupiter to swap SOL → STAY
4. **Distributes to winners** → After game ends

## ✅ Firebase Already Configured!

Your Firebase credentials are set up in `src/lib/firebase.ts`:
- **Project ID:** website-6889
- **Ready to deploy functions!**

## 🔧 Next Steps

### 1. Create `.env.local` file in your project root:

```env
# Your main treasury wallet (where players pay fees)
NEXT_PUBLIC_DEV_WALLET_ADDRESS=YOUR_MAIN_WALLET_ADDRESS_HERE

# Demo mode (set to false for production)
NEXT_PUBLIC_DEMO_MODE=false

# Your STAY token mint address (create on pump.fun)
STAY_TOKEN_MINT=YOUR_TOKEN_MINT_ADDRESS
```

### 2. Create `functions/.env` file for Firebase Functions:

```env
# DEV wallet private key (KEEP SECRET!)
DEV_WALLET_PRIVATE_KEY=your_wallet_private_key_in_base58

# Solana RPC
SOLANA_RPC_URL=https://api.devnet.solana.com

# Your token mint
STAY_TOKEN_MINT=YOUR_TOKEN_MINT_ADDRESS
```

### 3. Deploy Firebase Functions:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (choose existing project: website-6889)
firebase init

# Install function dependencies
cd functions
npm install

# Deploy functions
firebase deploy --only functions
```

## 🎮 Game Integration

### When Player Pays Fee:

```typescript
import { GamePaymentService } from '@/lib/firebase';

// After player sends SOL to your DEV wallet
await GamePaymentService.recordGamePayment(
  playerWallet.publicKey,
  gameId,
  feeAmount,
  transactionSignature
);
```

### After Game Ends:

```typescript
// Distribute tokens to winners
await GamePaymentService.distributeTokensToWinners(
  gameId,
  winnerWallets,
  tokenAmountPerWinner
);
```

## 🔍 Monitoring

### Check Treasury Status:

```typescript
const treasury = await GamePaymentService.getTreasuryStatus();
console.log('SOL Balance:', treasury.solBalance);
console.log('STAY Tokens:', treasury.stayTokenBalance);
```

## 💰 The Flow

1. **Player joins game** → Pays 0.1 SOL entry fee
2. **SOL goes to your DEV wallet** → Firebase detects increase
3. **Auto-buy STAY tokens** → Jupiter swaps SOL → STAY
4. **Game ends** → Winners get STAY token rewards
5. **Repeat** → More games = more token purchases!

## 🚀 What You Need Now

### **1. Treasury Wallet Setup:**
- Create or use existing Solana wallet as your treasury
- Fund it with some SOL for transaction fees (~0.1 SOL)
- Get the wallet address and private key

### **2. Create STAY Token:**
- Go to [pump.fun](https://pump.fun)
- Create your STAY token
- Get the token mint address

### **3. Update Environment:**
- Add your wallet address to `.env.local`
- Add your private key to `functions/.env`
- Add your token mint to both files

### **4. Deploy and Test:**
- Deploy Firebase functions
- Test with small amounts first
- Monitor the automatic purchasing!

## 🔒 Security Notes

- **Never share your private key** - only store in Firebase environment
- **Start with devnet** for testing
- **Use small amounts** initially
- **Private key is only for your treasury wallet**

---

**Firebase is configured! Now you just need your wallet and token setup.** 🎯

**Every game entry fee = automatic STAY token purchase!** 🚀 