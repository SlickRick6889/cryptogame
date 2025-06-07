const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

async function getDevnetSOL() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const publicKey = new PublicKey('5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4');
  
  console.log('🚰 Requesting devnet SOL...');
  console.log('Wallet:', publicKey.toString());
  
  try {
    // Check current balance
    const balance = await connection.getBalance(publicKey);
    console.log('Current balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    // Request airdrop
    console.log('Requesting 1 SOL airdrop...');
    const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
    
    // Wait for confirmation
    console.log('Transaction signature:', signature);
    console.log('Waiting for confirmation...');
    
    await connection.confirmTransaction(signature);
    
    // Check new balance
    const newBalance = await connection.getBalance(publicKey);
    console.log('✅ Success! New balance:', newBalance / LAMPORTS_PER_SOL, 'SOL');
    
  } catch (error) {
    console.error('❌ Airdrop failed:', error.message);
    console.log('\n🔄 Alternative options:');
    console.log('1. Try QuickNode faucet: https://faucet.quicknode.com/solana/devnet');
    console.log('2. Try SolFaucet: https://solfaucet.com/');
    console.log('3. Try Phantom wallet faucet (if you have Phantom)');
    console.log('4. Ask on Solana Discord: https://discord.gg/solana');
  }
}

getDevnetSOL(); 