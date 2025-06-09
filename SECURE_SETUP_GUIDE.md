# 🔐 SECURE TREASURY WALLET SETUP GUIDE

## 🚨 CRITICAL SECURITY REQUIREMENTS

### **1. GENERATE NEW SECURE WALLET (LOCAL ONLY)**

**Create wallet locally (NEVER online):**
```bash
# Install Solana CLI (if not installed)
# On Windows: Download from https://github.com/solana-labs/solana/releases

# Generate new keypair
solana-keygen new --outfile treasury-wallet.json

# Get the public address
solana-keygen pubkey treasury-wallet.json
```

**Copy the public address - this is your treasury wallet address**

### **2. CONFIGURE FIREBASE FUNCTIONS (SECURE)**

**Set private key in Firebase Functions config:**
```bash
# Convert keypair to base64
node -e "const fs = require('fs'); const keypair = JSON.parse(fs.readFileSync('treasury-wallet.json')); console.log(Buffer.from(keypair).toString('base64'));"

# Set in Firebase Functions config
firebase functions:config:set treasury.pk="[BASE64_PRIVATE_KEY_FROM_ABOVE]"
firebase functions:config:set treasury.address="[PUBLIC_ADDRESS_FROM_STEP_1]"

# Deploy functions to apply config
firebase deploy --only functions
```

### **3. UPDATE FIRESTORE CONFIG**

**In Firebase Console → Firestore → `config/game` document:**
- Set `treasuryAddress`: `[YOUR_PUBLIC_ADDRESS]`
- Remove or clear any existing `treasuryWallet` field (old security vulnerability)

### **4. SECURITY CLEANUP**

**Delete all local files:**
```bash
# Delete the keypair file (security risk if left on computer)
del treasury-wallet.json   # Windows
rm treasury-wallet.json    # Mac/Linux

# Clear terminal history
cls                         # Windows
clear && history -c         # Mac/Linux
```

## ✅ VERIFICATION STEPS

1. **Check Firebase Functions config:**
   ```bash
   firebase functions:config:get
   ```
   Should show `treasury.pk` and `treasury.address`

2. **Test the configuration:**
   - Deploy and test a small payment
   - Verify tokens work correctly
   - Monitor Firebase Functions logs

3. **Security checklist:**
   - [ ] No private keys in code files
   - [ ] No private keys in documentation
   - [ ] treasury-wallet.json deleted
   - [ ] Firebase Functions config set
   - [ ] Firestore updated with public address only

## 🛡️ ONGOING SECURITY

- **Never commit** private keys to Git
- **Never share** Firebase Functions config
- **Regularly monitor** treasury wallet transactions
- **Use separate wallets** for dev/test vs production
- **Keep minimal SOL** in treasury (only what's needed for operations)

## 🚨 IF COMPROMISED

If treasury wallet is ever compromised:
1. **IMMEDIATELY** generate new wallet (repeat this guide)
2. **Transfer all funds** from old wallet to new
3. **Update all configs** with new wallet
4. **Deploy immediately**
5. **Monitor old wallet** for any suspicious activity

## 💡 BEST PRACTICES

- **Use hardware wallet** for large amounts
- **Multi-sig wallet** for production
- **Regular security audits**
- **Monitor all transactions**
- **Keep backup of public address only** 