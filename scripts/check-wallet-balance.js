const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const WALLET_ADDRESS = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';

async function checkWalletBalance() {
  console.log('🔍 Checking Wallet Balance');
  console.log('==========================');
  console.log(`📍 Wallet: ${WALLET_ADDRESS}`);
  
  try {
    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const publicKey = new PublicKey(WALLET_ADDRESS);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(publicKey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;
    
    console.log(`💰 SOL Balance: ${solAmount} SOL`);
    console.log(`🔗 Explorer: https://explorer.solana.com/address/${WALLET_ADDRESS}?cluster=devnet`);
    
    if (solAmount === 0) {
      console.log('');
      console.log('⚠️  Wallet has no SOL!');
      console.log('💡 Get devnet SOL at: https://faucet.solana.com');
      console.log('🎮 You need SOL to play STAYPOOL!');
    } else if (solAmount >= 0.1) {
      console.log('');
      console.log('✅ Wallet has enough SOL to play STAYPOOL!');
      console.log('🎮 Ready to join games!');
    } else {
      console.log('');
      console.log('⚠️  Low SOL balance - may need more for game entry fees');
    }
    
  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
  }
}

checkWalletBalance(); 