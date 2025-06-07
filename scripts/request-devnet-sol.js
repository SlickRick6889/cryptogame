const axios = require('axios');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const WALLET_ADDRESS = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';

async function requestDevnetSol() {
  console.log('🚰 Requesting Devnet SOL');
  console.log('========================');
  console.log(`📍 Wallet: ${WALLET_ADDRESS}`);
  
  try {
    console.log('💧 Requesting SOL from devnet faucet...');
    
    // Method 1: Direct API call to Solana faucet
    const response = await axios.post('https://api.devnet.solana.com', {
      jsonrpc: '2.0',
      id: 1,
      method: 'requestAirdrop',
      params: [
        WALLET_ADDRESS,
        LAMPORTS_PER_SOL // 1 SOL
      ]
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.result) {
      console.log('✅ Airdrop successful!');
      console.log('🔗 Transaction:', response.data.result);
      
      // Wait a moment and check balance
      console.log('⏳ Waiting for confirmation...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
      const publicKey = new PublicKey(WALLET_ADDRESS);
      const balance = await connection.getBalance(publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      console.log(`💰 New balance: ${solBalance} SOL`);
      console.log('🎮 Ready to play STAYPOOL!');
      
    } else {
      throw new Error('No result from faucet');
    }
    
  } catch (error) {
    console.log('❌ Automatic request failed:', error.message);
    console.log('');
    console.log('🔧 Manual alternatives:');
    console.log('1. Visit: https://faucet.solana.com');
    console.log(`2. Enter wallet: ${WALLET_ADDRESS}`);
    console.log('3. Request SOL manually');
    console.log('');
    console.log('💡 Or use Solana CLI:');
    console.log(`solana airdrop 1 ${WALLET_ADDRESS} --url devnet`);
  }
}

requestDevnetSol(); 