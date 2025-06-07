const { 
  Connection, 
  PublicKey, 
  Keypair, 
  clusterApiUrl,
  Transaction
} = require('@solana/web3.js');
const { 
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const axios = require('axios');
const bs58 = require('bs58');

// Configuration
const DEV_WALLET_PRIVATE_KEY = '5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp';
const USDC_DEV_TOKEN = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const TOKEN_AMOUNT = 1000;

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// Decode the base58 private key (same as Firebase functions)
function getDevWallet() {
  if (!DEV_WALLET_PRIVATE_KEY) {
    throw new Error('DEV wallet private key not configured');
  }
  return Keypair.fromSecretKey(bs58.decode(DEV_WALLET_PRIVATE_KEY));
}

async function createTokenAccountIfNeeded(wallet, tokenMint) {
  console.log('🏗️  Creating token account if needed...');
  
  try {
    const associatedTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      wallet.publicKey
    );
    
    console.log('📍 Token Account Address:', associatedTokenAccount.toString());
    
    // Check if account exists
    try {
      const accountInfo = await connection.getAccountInfo(associatedTokenAccount);
      if (accountInfo) {
        console.log('✅ Token account already exists');
        return associatedTokenAccount;
      }
    } catch (e) {
      console.log('📝 Token account does not exist, creating...');
    }
    
    // Create the associated token account
    const instruction = createAssociatedTokenAccountInstruction(
      wallet.publicKey,           // payer
      associatedTokenAccount,     // associatedToken
      wallet.publicKey,           // owner
      tokenMint                   // mint
    );
    
    const transaction = new Transaction().add(instruction);
    
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Sign and send
    transaction.sign(wallet);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    console.log('⏳ Waiting for confirmation...');
    await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('✅ Token account created!');
    console.log('🔗 Signature:', signature);
    
    return associatedTokenAccount;
    
  } catch (error) {
    console.error('❌ Error creating token account:', error);
    return null;
  }
}

async function requestTokensFromSolanaFaucet(wallet, tokenMint, amount) {
  console.log('🚰 Method 1: Requesting tokens from Solana faucet...');
  
  try {
    // Try the Solana faucet API
    const response = await axios.post('https://api.devnet.solana.com', {
      jsonrpc: '2.0',
      id: 1,
      method: 'requestAirdrop',
      params: [
        wallet.publicKey.toString(),
        amount * 1000000, // Convert to lamports equivalent for tokens
        tokenMint.toString()
      ]
    });
    
    if (response.data && response.data.result) {
      console.log('✅ Faucet request successful!');
      console.log('🔗 Transaction:', response.data.result);
      return true;
    }
  } catch (error) {
    console.log('❌ Solana faucet failed:', error.response?.status || error.message);
  }
  
  return false;
}

async function requestTokensFromWebFaucet(wallet, tokenMint, amount) {
  console.log('🚰 Method 2: Requesting tokens from web faucet...');
  
  try {
    const response = await axios.post('https://faucet.solana.com/api/faucet/airdrop', {
      recipient: wallet.publicKey.toString(),
      mint: tokenMint.toString(),
      amount: amount
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status === 200) {
      console.log('✅ Web faucet request successful!');
      console.log('📋 Response:', response.data);
      return true;
    }
  } catch (error) {
    console.log('❌ Web faucet failed:', error.response?.status || error.message);
  }
  
  return false;
}

async function requestTokensAlternativeFaucet(wallet, tokenMint, amount) {
  console.log('🚰 Method 3: Requesting from alternative faucet...');
  
  try {
    const response = await axios.post('https://faucet.triangleplatform.com/api/devnet/airdrop', {
      address: wallet.publicKey.toString(),
      token: tokenMint.toString(),
      amount: amount
    });
    
    if (response.status === 200) {
      console.log('✅ Alternative faucet successful!');
      return true;
    }
  } catch (error) {
    console.log('❌ Alternative faucet failed:', error.response?.status || error.message);
  }
  
  return false;
}

async function checkTokenBalance(wallet, tokenMint) {
  try {
    const associatedTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      wallet.publicKey
    );
    
    const balance = await connection.getTokenAccountBalance(associatedTokenAccount);
    return balance.value.uiAmount || 0;
  } catch (error) {
    return 0;
  }
}

async function main() {
  console.log('💰 STAYPOOL - Auto-Fund Dev Wallet with USDC-Dev');
  console.log('=================================================');
  
  try {
    // Get dev wallet
    const devWallet = getDevWallet();
    const tokenMint = new PublicKey(USDC_DEV_TOKEN);
    
    console.log('🏛️  Dev Wallet:', devWallet.publicKey.toString());
    console.log('🪙 Token Mint:', USDC_DEV_TOKEN);
    console.log('💎 Target Amount:', TOKEN_AMOUNT, 'tokens');
    console.log('');
    
    // Check current balance
    let currentBalance = await checkTokenBalance(devWallet, tokenMint);
    console.log('💰 Current USDC-Dev Balance:', currentBalance);
    
    if (currentBalance >= 100) {
      console.log('✅ Dev wallet already has enough tokens!');
      return;
    }
    
    // Create token account if needed
    const tokenAccount = await createTokenAccountIfNeeded(devWallet, tokenMint);
    if (!tokenAccount) {
      console.log('❌ Failed to create token account');
      return;
    }
    
    console.log('\n💰 Attempting to fund with', TOKEN_AMOUNT, 'USDC-Dev tokens...');
    
    // Try multiple faucet methods
    let success = false;
    
    success = await requestTokensFromSolanaFaucet(devWallet, tokenMint, TOKEN_AMOUNT);
    if (success) {
      console.log('🎉 Funded via Solana faucet!');
    } else {
      success = await requestTokensFromWebFaucet(devWallet, tokenMint, TOKEN_AMOUNT);
      if (success) {
        console.log('🎉 Funded via web faucet!');
      } else {
        success = await requestTokensAlternativeFaucet(devWallet, tokenMint, TOKEN_AMOUNT);
        if (success) {
          console.log('🎉 Funded via alternative faucet!');
        }
      }
    }
    
    if (success) {
      // Wait a bit and check balance
      console.log('\n⏳ Waiting 10 seconds for tokens to arrive...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const newBalance = await checkTokenBalance(devWallet, tokenMint);
      console.log('💰 New USDC-Dev Balance:', newBalance);
      
      if (newBalance > currentBalance) {
        console.log('✅ SUCCESS! Dev wallet funded with tokens!');
        console.log('🎮 You can now play the game and receive tokens when you win!');
      } else {
        console.log('⏳ Tokens may still be processing...');
      }
    } else {
      console.log('\n❌ All automatic funding methods failed.');
      console.log('\n🛠️  MANUAL STEPS:');
      console.log('1. Visit: https://faucet.solana.com/');
      console.log('2. Select "Custom SPL Token"');
      console.log('3. Token mint:', USDC_DEV_TOKEN);
      console.log('4. Wallet address:', devWallet.publicKey.toString());
      console.log('5. Request 1000 tokens');
    }
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

main().catch(console.error); 