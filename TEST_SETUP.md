# 🧪 STAYPOOL Test Environment Setup

## 🚀 Test Treasury Wallet Generated!

**📍 Treasury Address:** `5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4`  
**🔐 Private Key:** `5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp`

## 🪙 Test Token (USDC-Dev)

**Token Mint:** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`  
**Symbol:** USDC-Dev  
**Decimals:** 6  

## ⚙️ Setup Environment Files

### 1. Create `.env.local`:
```env
# Test treasury wallet
NEXT_PUBLIC_DEV_WALLET_ADDRESS=5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4

# Demo mode off for testing
NEXT_PUBLIC_DEMO_MODE=false

# Test token
STAY_TOKEN_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

### 2. Create `functions/.env`:
```env
# Treasury private key (TESTING ONLY!)
DEV_WALLET_PRIVATE_KEY=5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp

# Devnet RPC
SOLANA_RPC_URL=https://api.devnet.solana.com

# Test token mint
STAY_TOKEN_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

## 🔄 Testing Steps

### 1. Fund Test Wallet
```bash
# Visit devnet faucet
# https://faucet.solana.com
# Request SOL for: 5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4
```

### 2. Deploy Firebase Functions
```bash
# Install Firebase CLI (if not installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize project
firebase init

# Deploy functions
firebase deploy --only functions
```

### 3. Test the Flow
1. **Player pays SOL** → Send to treasury wallet
2. **Firebase detects payment** → Within 1 minute
3. **Auto-buys USDC-Dev tokens** → Using Jupiter
4. **Verifies system works** → Check Firebase logs

### 4. Monitor Test Results
```bash
# Check Firebase function logs
firebase functions:log

# Check treasury wallet balance
# Use Solscan devnet explorer
```

## 🎯 Test Scenarios

### **Scenario 1: Single Payment**
- Send 0.01 SOL to treasury
- Wait 1 minute for monitoring
- Check if USDC-Dev was purchased

### **Scenario 2: Multiple Payments**
- Send several small payments
- Verify each triggers token purchase
- Check accumulated token balance

### **Scenario 3: Game Integration**
- Run STAYPOOL game
- Connect wallet and "pay" to treasury
- Test recordGamePayment function

## 🔍 Debugging

### Check Treasury Balance:
- **Devnet Explorer:** https://explorer.solana.com/?cluster=devnet
- **Address:** 5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4

### Firebase Function Logs:
```bash
firebase functions:log --only monitorDevWallet
firebase functions:log --only recordGamePayment
```

### Manual Token Purchase Test:
```typescript
import { GamePaymentService } from '@/lib/firebase';

// Test manual purchase
await GamePaymentService.buyTokensManually(0.01);
```

## ⚠️ Important Notes

- **DEVNET ONLY** - These are test credentials
- **Not for production** - Generate new wallet for mainnet
- **Small amounts** - Test with 0.01-0.05 SOL
- **Monitor closely** - Watch Firebase logs for errors

---

**Ready to test the automated token purchase system!** 🚀 