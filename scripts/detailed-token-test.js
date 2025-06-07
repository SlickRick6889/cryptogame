const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const axios = require('axios');

// Configuration
const FIREBASE_FUNCTIONS_URL = 'https://us-central1-website-6889.cloudfunctions.net';
const USER_WALLET = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';
const DEV_WALLET = '5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4';
const DUMMY_TOKEN_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

async function checkTokenBalancesBefore() {
  console.log('🔍 BEFORE TOKEN DISTRIBUTION');
  console.log('============================');
  
  try {
    const tokenMint = new PublicKey(DUMMY_TOKEN_MINT);
    
    // Check user token balance
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(USER_WALLET)
    );
    
    // Check dev token balance
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(DEV_WALLET)
    );
    
    console.log('👤 User Token Account:', userTokenAccount.toString());
    console.log('🏛️  Dev Token Account:', devTokenAccount.toString());
    
    try {
      const userTokenInfo = await connection.getTokenAccountBalance(userTokenAccount);
      console.log('💰 User DUMMY Balance:', userTokenInfo.value.uiAmount || 0);
    } catch (e) {
      console.log('💰 User DUMMY Balance: 0 (no token account)');
    }
    
    try {
      const devTokenInfo = await connection.getTokenAccountBalance(devTokenAccount);
      console.log('💰 Dev DUMMY Balance:', devTokenInfo.value.uiAmount || 0);
    } catch (e) {
      console.log('💰 Dev DUMMY Balance: 0 (no token account)');
    }
    
  } catch (error) {
    console.error('❌ Error checking balances:', error.message);
  }
  
  console.log('');
}

async function testTokenDistribution() {
  console.log('🧪 CALLING TOKEN DISTRIBUTION');
  console.log('=============================');
  
  try {
    const gameId = 'detailed-test-' + Date.now();
    console.log('Game ID:', gameId);
    console.log('Winner:', USER_WALLET);
    console.log('Amount: 100 DUMMY tokens');
    console.log('');
    
    const response = await axios.post(`${FIREBASE_FUNCTIONS_URL}/distributeTokensToWinners`, {
      data: {
        gameId,
        winners: [USER_WALLET],
        tokenAmountPerWinner: 100,
        tokenMint: DUMMY_TOKEN_MINT
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 45000 // 45 second timeout
    });
    
    console.log('📤 Full Function Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    
    return response.data.result;
    
  } catch (error) {
    console.error('❌ Error calling function:', error.response?.data || error.message);
    return null;
  }
}

async function checkTokenBalancesAfter() {
  console.log('🔍 AFTER TOKEN DISTRIBUTION');
  console.log('===========================');
  
  // Wait a moment for blockchain to update
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    const tokenMint = new PublicKey(DUMMY_TOKEN_MINT);
    
    // Check user token balance
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(USER_WALLET)
    );
    
    // Check dev token balance
    const devTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      new PublicKey(DEV_WALLET)
    );
    
    try {
      const userTokenInfo = await connection.getTokenAccountBalance(userTokenAccount);
      console.log('💰 User DUMMY Balance:', userTokenInfo.value.uiAmount || 0);
      return userTokenInfo.value.uiAmount || 0;
    } catch (e) {
      console.log('💰 User DUMMY Balance: 0 (no token account created)');
      return 0;
    }
    
  } catch (error) {
    console.error('❌ Error checking final balances:', error.message);
    return 0;
  }
}

async function main() {
  console.log('🎮 DETAILED TOKEN DISTRIBUTION TEST');
  console.log('===================================');
  console.log('');
  
  // Step 1: Check balances before
  await checkTokenBalancesBefore();
  
  // Step 2: Call token distribution
  const result = await testTokenDistribution();
  
  // Step 3: Check balances after
  const finalBalance = await checkTokenBalancesAfter();
  
  // Step 4: Summary
  console.log('');
  console.log('📊 TEST SUMMARY');
  console.log('===============');
  
  if (result && result.success) {
    console.log('✅ Function call: SUCCESS');
    console.log('📝 Function message:', result.message);
    
    if (result.results) {
      console.log('🔍 Distribution results:');
      result.results.forEach(r => {
        console.log(`  - ${r.winner}: ${r.status}`);
        if (r.signature) console.log(`    Signature: ${r.signature}`);
        if (r.error) console.log(`    Error: ${r.error}`);
      });
    }
  } else {
    console.log('❌ Function call: FAILED');
  }
  
  if (finalBalance > 0) {
    console.log(`🎉 TOKENS RECEIVED: ${finalBalance} DUMMY tokens!`);
  } else {
    console.log('😞 NO TOKENS RECEIVED - Something went wrong');
  }
}

main().catch(console.error); 