const { 
  Connection, 
  PublicKey, 
  Keypair, 
  clusterApiUrl,
  Transaction
} = require('@solana/web3.js');
const { 
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');

// Configuration
const DEV_WALLET_PRIVATE_KEY = '5GwBJRCsJngiDp3JuPzFNtaCfHLwMQ6Thf2xPdiBjZwZNNLRkYQLMquoVevmocVmctBm14K7mP4TXggz9vnMS2cp';
const USDC_DEV_TOKEN = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const TOKEN_AMOUNT = 1000; // Fund with 1000 USDC-Dev tokens

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

function getDevWallet() {
  // The private key is in base58 format, decode it directly
  const bs58 = require('bs58').default || require('bs58');
  const privateKeyBytes = bs58.decode(DEV_WALLET_PRIVATE_KEY);
  return Keypair.fromSecretKey(privateKeyBytes);
}

async function requestTokensFromFaucet() {
  console.log('🚰 Requesting USDC-Dev tokens from faucet...');
  
  const devWallet = getDevWallet();
  const tokenMint = new PublicKey(USDC_DEV_TOKEN);
  
  try {
    // For devnet test tokens, we need to use a faucet or airdrop service
    // Let's try a direct approach using the test token faucet
    
    const response = await fetch('https://faucet.solana.com/api/faucet/airdrop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: devWallet.publicKey.toString(),
        mint: USDC_DEV_TOKEN,
        amount: TOKEN_AMOUNT
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Token airdrop successful:', result);
      return true;
    } else {
      console.log('❌ Faucet response:', response.status, await response.text());
    }
  } catch (error) {
    console.log('❌ Faucet request failed:', error.message);
  }
  
  return false;
}

async function createTokenAccount() {
  console.log('💰 Creating token account for dev wallet...');
  
  const devWallet = getDevWallet();
  const tokenMint = new PublicKey(USDC_DEV_TOKEN);
  
  try {
    // Get the associated token account address
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      devWallet.publicKey
    );
    
    console.log('🏛️  Dev Token Account:', devTokenAccount.toString());
    
    // Check if account already exists
    try {
      const accountInfo = await connection.getAccountInfo(devTokenAccount);
      if (accountInfo) {
        console.log('✅ Token account already exists');
        return devTokenAccount;
      }
    } catch (e) {
      // Account doesn't exist, need to create it
    }
    
    // Create the associated token account
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        devWallet.publicKey,    // payer
        devTokenAccount,        // associated token account
        devWallet.publicKey,    // owner
        tokenMint              // mint
      )
    );
    
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = devWallet.publicKey;
    
    // Sign and send transaction
    transaction.sign(devWallet);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature);
    
    console.log('✅ Token account created!');
    console.log('🔗 Signature:', signature);
    
    return devTokenAccount;
    
  } catch (error) {
    console.error('❌ Error creating token account:', error);
    return null;
  }
}

async function checkDevTokenBalance() {
  console.log('🔍 Checking dev wallet token balance...');
  
  const devWallet = getDevWallet();
  const tokenMint = new PublicKey(USDC_DEV_TOKEN);
  
  try {
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      devWallet.publicKey
    );
    
    const balance = await connection.getTokenAccountBalance(devTokenAccount);
    const tokenBalance = balance.value.uiAmount || 0;
    
    console.log('💰 Dev USDC-Dev Balance:', tokenBalance);
    
    if (tokenBalance >= 100) {
      console.log('✅ Dev wallet has enough tokens to distribute!');
    } else {
      console.log('❌ Dev wallet needs more tokens');
    }
    
    return tokenBalance;
    
  } catch (error) {
    console.log('❌ Error checking balance:', error);
    return 0;
  }
}

async function main() {
  console.log('💰 STAYPOOL - Fund Dev Wallet with Tokens');
  console.log('==========================================');
  
  const devWallet = getDevWallet();
  console.log('🏛️  Dev Wallet:', devWallet.publicKey.toString());
  console.log('🪙 Token Mint:', USDC_DEV_TOKEN);
  console.log('💎 Target Amount:', TOKEN_AMOUNT, 'tokens');
  console.log('');
  
  // Check current balance
  let currentBalance = await checkDevTokenBalance();
  
  if (currentBalance >= 100) {
    console.log('🎉 Dev wallet already has enough tokens!');
    return;
  }
  
  // Create token account if needed
  const tokenAccount = await createTokenAccount();
  if (!tokenAccount) {
    console.log('❌ Failed to create token account');
    return;
  }
  
  // Try to get tokens from faucet
  const gotTokens = await requestTokensFromFaucet();
  
  if (!gotTokens) {
    console.log('\n🛠️  MANUAL STEPS NEEDED:');
    console.log('1. Visit: https://faucet.solana.com/');
    console.log('2. Select "Custom SPL Token"');
    console.log('3. Enter token mint:', USDC_DEV_TOKEN);
    console.log('4. Enter dev wallet:', devWallet.publicKey.toString());
    console.log('5. Request tokens');
    console.log('');
    console.log('OR try this command:');
    console.log(`spl-token mint ${USDC_DEV_TOKEN} ${TOKEN_AMOUNT} ${tokenAccount.toString()} --owner ${devWallet.publicKey.toString()}`);
  }
  
  // Check balance again after a delay
  setTimeout(async () => {
    console.log('\n⏳ Checking balance after funding attempt...');
    await checkDevTokenBalance();
  }, 3000);
}

main().catch(console.error); 