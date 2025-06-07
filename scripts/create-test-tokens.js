const { 
  Connection, 
  PublicKey, 
  clusterApiUrl, 
  Keypair,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const { 
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// Dev wallet (we'll create tokens for this wallet)
const DEV_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';

async function createTestTokensForDev() {
  console.log('🎮 STAYPOOL - Create Test Tokens for Dev Wallet');
  console.log('===============================================');
  
  try {
    // Create a temporary keypair to act as mint authority
    const payer = Keypair.generate();
    console.log('👤 Temporary Payer:', payer.publicKey.toString());
    
    // Fund the payer with SOL first
    console.log('💰 Requesting SOL for payer...');
    try {
      const signature = await connection.requestAirdrop(payer.publicKey, 2000000000); // 2 SOL
      await connection.confirmTransaction(signature);
      console.log('✅ Payer funded with SOL');
    } catch (e) {
      console.log('❌ Failed to fund payer, trying alternative...');
      console.log('🛠️  MANUAL STEPS NEEDED:');
      console.log('1. Go to https://faucet.solana.com/');
      console.log('2. Fund this address with 2 SOL:', payer.publicKey.toString());
      console.log('3. Run this script again');
      return;
    }
    
    // Create a new token mint (our custom test token)
    console.log('🪙 Creating test token mint...');
    const mint = await createMint(
      connection,
      payer,          // payer
      payer.publicKey, // mint authority
      null,           // freeze authority
      6               // decimals (same as USDC)
    );
    
    console.log('✅ Test token created:', mint.toString());
    
    // Get or create token account for dev wallet
    console.log('🏗️  Creating token account for dev wallet...');
    const devWalletKey = new PublicKey(DEV_WALLET);
    const devTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,          // payer
      mint,           // mint
      devWalletKey    // owner
    );
    
    console.log('✅ Dev token account:', devTokenAccount.address.toString());
    
    // Mint 10,000 tokens to dev wallet
    const mintAmount = 10000 * Math.pow(10, 6); // 10,000 tokens with 6 decimals
    console.log('🎯 Minting 10,000 test tokens to dev wallet...');
    
    await mintTo(
      connection,
      payer,                    // payer
      mint,                     // mint
      devTokenAccount.address,  // destination
      payer.publicKey,          // authority
      mintAmount                // amount
    );
    
    console.log('🎉 SUCCESS! Test tokens minted to dev wallet!');
    console.log('');
    console.log('📋 SUMMARY:');
    console.log('==========');
    console.log('🪙 Test Token Mint:', mint.toString());
    console.log('🏛️  Dev Wallet:', DEV_WALLET);
    console.log('📊 Dev Token Account:', devTokenAccount.address.toString());
    console.log('💰 Amount Minted: 10,000 tokens');
    console.log('');
    console.log('🔧 NEXT STEPS:');
    console.log('==============');
    console.log('1. Update your game to use this test token instead of USDC-Dev');
    console.log('2. Replace USDC_DEV_TOKEN in your code with:', mint.toString());
    console.log('3. Test the game - winners will now receive these test tokens!');
    console.log('');
    console.log('OR copy this info and try other faucets with the original USDC-Dev token.');
    
  } catch (error) {
    console.error('💥 Error:', error);
    
    if (error.message.includes('429')) {
      console.log('\n🚰 Rate limited! Try these alternatives:');
      console.log('1. https://solfaucet.com/');
      console.log('2. https://faucet.quicknode.com/solana/devnet');
      console.log('3. Wait an hour and try again');
    }
  }
}

createTestTokensForDev(); 