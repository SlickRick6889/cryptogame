const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

// Configuration
const DEV_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';
const USDC_DEV_TOKEN = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

async function main() {
  console.log('💰 STAYPOOL - Fund Dev Wallet with USDC-Dev Tokens');
  console.log('===================================================');
  console.log('');
  
  // Calculate the associated token account
  const tokenMint = new PublicKey(USDC_DEV_TOKEN);
  const devWalletKey = new PublicKey(DEV_WALLET);
  const devTokenAccount = await getAssociatedTokenAddress(tokenMint, devWalletKey);
  
  console.log('🏛️  Dev Wallet:', DEV_WALLET);
  console.log('🪙 USDC-Dev Token:', USDC_DEV_TOKEN);
  console.log('📊 Dev Token Account:', devTokenAccount.toString());
  console.log('');
  
  // Check current balance
  try {
    const balance = await connection.getTokenAccountBalance(devTokenAccount);
    const tokenBalance = balance.value.uiAmount || 0;
    console.log('💰 Current USDC-Dev Balance:', tokenBalance);
    
    if (tokenBalance >= 100) {
      console.log('✅ Dev wallet already has enough tokens!');
      return;
    }
  } catch (e) {
    console.log('❌ Dev wallet has no USDC-Dev token account yet');
  }
  
  console.log('\n🛠️  MANUAL FUNDING STEPS:');
  console.log('========================');
  console.log('');
  console.log('1. 🌐 Visit: https://faucet.solana.com/');
  console.log('2. 📱 Select "Custom SPL Token"');
  console.log('3. 📝 Enter token mint address:');
  console.log('   ', USDC_DEV_TOKEN);
  console.log('4. 📝 Enter dev wallet address:');
  console.log('   ', DEV_WALLET);
  console.log('5. 💰 Request 1000 tokens');
  console.log('');
  console.log('OR use Solana CLI:');
  console.log('------------------');
  console.log('spl-token create-account', USDC_DEV_TOKEN);
  console.log('spl-token mint', USDC_DEV_TOKEN, '1000', devTokenAccount.toString());
  console.log('');
  console.log('🎯 Why this is needed:');
        console.log('- Your game successfully collected 0.05 SOL entry fee');
  console.log('- Dev wallet needs USDC-Dev tokens to distribute to winners');
  console.log('- Once funded, winners will automatically receive 100 USDC-Dev tokens');
  console.log('');
  console.log('🚀 After funding, test by playing the game again!');
}

main().catch(console.error); 