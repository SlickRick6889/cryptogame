const { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');

// Treasury wallet (where payments go)
const TREASURY_ADDRESS = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';

async function sendTestPayment() {
  console.log('💰 Sending Test Payment to Treasury');
  console.log('====================================');
  
  try {
    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // For testing, you'd need to provide your own wallet private key here
    // This is just showing the structure
    console.log('📍 Treasury Address:', TREASURY_ADDRESS);
    console.log('');
    console.log('To test payments:');
    console.log('1. Use your own wallet to send 0.05 SOL to treasury');
    console.log('2. Check Firebase functions should detect the payment');
    console.log('3. Automatically purchase USDC-Dev tokens');
    console.log('');
    console.log('🔗 Treasury on Explorer:');
    console.log(`https://explorer.solana.com/address/${TREASURY_ADDRESS}?cluster=devnet`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

sendTestPayment(); 