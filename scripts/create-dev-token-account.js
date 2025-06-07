const { 
  Connection, 
  PublicKey, 
  clusterApiUrl
} = require('@solana/web3.js');
const { 
  getAssociatedTokenAddress
} = require('@solana/spl-token');
const axios = require('axios');

// Configuration
const DEV_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';
const USDC_DEV_TOKEN = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

async function fundDevWalletWithTokens() {
  console.log('💰 STAYPOOL - Fund Dev Wallet with USDC-Dev Tokens');
  console.log('===================================================');
  
  const devWalletKey = new PublicKey(DEV_WALLET);
  const tokenMint = new PublicKey(USDC_DEV_TOKEN);
  
  console.log('🏛️  Dev Wallet:', DEV_WALLET);
  console.log('🪙 Token Mint:', USDC_DEV_TOKEN);
  
  try {
    // Get the associated token account
    const devTokenAccount = await getAssociatedTokenAddress(tokenMint, devWalletKey);
    console.log('📊 Token Account:', devTokenAccount.toString());
    
    // Check current balance
    let currentBalance = 0;
    try {
      const balance = await connection.getTokenAccountBalance(devTokenAccount);
      currentBalance = balance.value.uiAmount || 0;
      console.log('💰 Current Balance:', currentBalance, 'USDC-Dev');
    } catch (e) {
      console.log('❌ No token account exists yet');
    }
    
    if (currentBalance >= 100) {
      console.log('✅ Dev wallet already has enough tokens!');
      return;
    }
    
    // Try multiple faucet services
    console.log('\n🚰 Requesting tokens from faucets...');
    
    // Method 1: Direct faucet API
    try {
      console.log('📡 Trying faucet method 1...');
      const response1 = await axios.post('https://faucet.solana.com/api/faucet/airdrop', {
        recipient: DEV_WALLET,
        mint: USDC_DEV_TOKEN,
        amount: 1000
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response1.status === 200) {
        console.log('✅ Method 1 successful!', response1.data);
      }
    } catch (err) {
      console.log('❌ Method 1 failed:', err.response?.status || err.message);
    }
    
    // Method 2: Alternative endpoint
    try {
      console.log('📡 Trying faucet method 2...');
      const response2 = await axios.get(`https://faucet.solana.com/api/faucet/airdrop/${DEV_WALLET}/${USDC_DEV_TOKEN}/1000`, {
        timeout: 10000
      });
      
      if (response2.status === 200) {
        console.log('✅ Method 2 successful!', response2.data);
      }
    } catch (err) {
      console.log('❌ Method 2 failed:', err.response?.status || err.message);
    }
    
    // Method 3: Using RPC call to request airdrop
    try {
      console.log('📡 Trying RPC airdrop...');
      
      // Some test tokens allow direct airdrop via RPC
      const signature = await connection.requestAirdrop(devWalletKey, 1000000000); // Try 1 SOL worth
      console.log('✅ RPC airdrop requested:', signature);
      
    } catch (err) {
      console.log('❌ RPC airdrop failed:', err.message);
    }
    
    console.log('\n⏳ Waiting 10 seconds for tokens to arrive...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check balance again
    try {
      const newBalance = await connection.getTokenAccountBalance(devTokenAccount);
      const newAmount = newBalance.value.uiAmount || 0;
      console.log('💰 New Balance:', newAmount, 'USDC-Dev');
      
      if (newAmount > currentBalance) {
        console.log('🎉 SUCCESS! Tokens received!');
        console.log('🎮 You can now test the game token distribution!');
      } else {
        console.log('❌ No new tokens received automatically');
      }
    } catch (e) {
      console.log('❌ Still no token account');
    }
    
    // Show manual steps if automatic failed
    console.log('\n🛠️  MANUAL FUNDING OPTIONS:');
    console.log('============================');
    console.log('');
    console.log('Option 1 - Web Faucet:');
    console.log('1. 🌐 Visit: https://faucet.solana.com/');
    console.log('2. Select "Custom SPL Token"');
    console.log('3. Token Address:', USDC_DEV_TOKEN);
    console.log('4. Recipient Address:', DEV_WALLET);
    console.log('5. Amount: 1000');
    console.log('');
    console.log('Option 2 - Alternative Faucet:');
    console.log('🌐 Visit: https://faucet.triangleplatform.com/solana/devnet');
    console.log('');
    console.log('Option 3 - Solana CLI:');
    console.log('spl-token create-account', USDC_DEV_TOKEN);
    console.log('spl-token mint', USDC_DEV_TOKEN, '1000', devTokenAccount.toString());
    console.log('');
    console.log('🎯 After funding, run the verification script:');
    console.log('node scripts/verify-payment-flow.js');
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

fundDevWalletWithTokens(); 