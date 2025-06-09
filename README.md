# 🎮 STAYPOOL - Crypto Elimination Game

A Solana-based elimination game where players compete to be the last one standing and win BALL tokens.

## 🚀 Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Development**
   ```bash
   npm run dev
   ```

3. **Deploy**
   ```bash
   npm run deploy
   ```

## 🏗 Architecture

- **Frontend**: Next.js + TypeScript + TailwindCSS
- **Backend**: Firebase Functions + Firestore  
- **Blockchain**: Solana + Jupiter (token swaps)
- **Wallet**: Solana Wallet Adapter

## 🔐 Security Setup

Follow `SECURE_SETUP_GUIDE.md` for secure treasury wallet configuration.

## 🎮 How It Works

1. Players connect Solana wallets and pay entry fee
2. Entry fees are converted to BALL tokens via Jupiter
3. Players are eliminated in random rounds  
4. Last player standing wins the token pool

## 📁 Core Files

```
src/app/page.tsx          # Main game interface
src/lib/payment.ts        # Payment processing
src/contexts/GameContext.tsx # Game state management
functions/src/index.ts    # Firebase backend functions
```

## 🚀 Deployment

- **Frontend**: Firebase Hosting
- **Backend**: Firebase Functions
- **Database**: Firestore

## ⚙️ Configuration

Set up your treasury wallet using the secure setup guide before going live. 