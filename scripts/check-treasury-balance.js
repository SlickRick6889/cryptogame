const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Our test treasury wallet
const TREASURY_ADDRESS = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';

async function checkTreasuryBalance() {
  console.log('🔍 Checking Treasury Wallet Balance...');
  console.log('=====================================');
  
  try {
    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const publicKey = new PublicKey(TREASURY_ADDRESS);
    
    // Get SOL balance
    const solBalance = await connection.getBalance(publicKey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;
    
    console.log(`📍 Treasury Address: ${TREASURY_ADDRESS}`);
    console.log(`💰 SOL Balance: ${solAmount} SOL`);
    console.log(`🔗 Explorer: https://explorer.solana.com/address/${TREASURY_ADDRESS}?cluster=devnet`);
    
    if (solAmount === 0) {
      console.log('');
      console.log('⚠️  Treasury wallet has no SOL!');
      console.log('💡 Fund it at: https://faucet.solana.com');
      console.log(`📋 Address to fund: ${TREASURY_ADDRESS}`);
    } else {
      console.log('');
      console.log('✅ Treasury wallet is funded and ready for testing!');
    }
    
  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
  }
}

checkTreasuryBalance(); 