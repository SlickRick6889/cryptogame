const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const axios = require('axios');

const USER_WALLET = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

async function fundUserWallet() {
  console.log('💰 Funding user wallet with devnet SOL...');
  console.log('🔗 User wallet:', USER_WALLET);
  
  try {
    // Method 1: Solana CLI faucet
    console.log('\n📡 Method 1: Trying Solana CLI faucet...');
    try {
      const response = await axios.post('https://api.devnet.solana.com', {
        jsonrpc: '2.0',
        id: 1,
        method: 'requestAirdrop',
        params: [USER_WALLET, 1000000000] // 1 SOL
      });
      
      if (response.data.result) {
        console.log('✅ Airdrop successful!');
        console.log('🎯 Transaction signature:', response.data.result);
        return true;
      }
    } catch (err) {
      console.log('❌ Method 1 failed:', err.response?.status || err.message);
    }
    
    // Method 2: Alternative faucet endpoint
    console.log('\n📡 Method 2: Trying alternative endpoint...');
    try {
      const response = await axios.post('https://faucet.solana.com/api/faucet/airdrop/' + USER_WALLET);
      console.log('✅ Alternative faucet response:', response.data);
      return true;
    } catch (err) {
      console.log('❌ Method 2 failed:', err.response?.status || err.message);
    }
    
    // Method 3: Direct RPC call
    console.log('\n📡 Method 3: Direct RPC call...');
    try {
      const userPublicKey = new PublicKey(USER_WALLET);
      const signature = await connection.requestAirdrop(userPublicKey, 1000000000); // 1 SOL
      console.log('✅ Direct RPC airdrop successful!');
      console.log('🎯 Transaction signature:', signature);
      
      // Wait for confirmation
      await connection.confirmTransaction(signature);
      console.log('✅ Transaction confirmed!');
      return true;
    } catch (err) {
      console.log('❌ Method 3 failed:', err.message);
    }
    
    console.log('\n❌ All funding methods failed. Try these manual options:');
    console.log('1. 🌐 Web faucet: https://faucet.solana.com/');
    console.log('2. 🌐 Alternative: https://faucet.triangleplatform.com/solana/devnet');
    console.log('3. 🌐 Another option: https://solfaucet.com/');
    console.log('4. 💻 Solana CLI: solana airdrop 1 ' + USER_WALLET + ' --url devnet');
    
    return false;
    
  } catch (error) {
    console.error('💥 Error funding wallet:', error);
    return false;
  }
}

async function checkBalance() {
  try {
    const userPublicKey = new PublicKey(USER_WALLET);
    const balance = await connection.getBalance(userPublicKey);
    const solBalance = balance / 1000000000;
    
    console.log('\n💰 Current wallet balance:');
    console.log('🔗 Wallet:', USER_WALLET);
    console.log('💎 Balance:', solBalance.toFixed(6), 'SOL');
    
    if (solBalance >= 0.11) {
      console.log('✅ Wallet has enough SOL to play! (need 0.11 SOL for entry fee + tx fee)');
    } else {
      console.log('❌ Need more SOL to play. Required: 0.11 SOL');
    }
    
    return solBalance;
  } catch (error) {
    console.error('❌ Error checking balance:', error);
    return 0;
  }
}

async function main() {
  console.log('🎮 STAYPOOL - User Wallet Funding');
  console.log('=====================================');
  
  // Check current balance
  const currentBalance = await checkBalance();
  
  if (currentBalance >= 0.11) {
    console.log('\n🎉 Wallet already has enough SOL!');
    return;
  }
  
  // Try to fund the wallet
  console.log('\n💰 Attempting to fund wallet...');
  const funded = await fundUserWallet();
  
  if (funded) {
    // Wait a bit and check balance again
    console.log('\n⏳ Waiting 5 seconds for balance update...');
    setTimeout(async () => {
      await checkBalance();
    }, 5000);
  }
}

main().catch(console.error); 