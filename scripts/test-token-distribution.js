const axios = require('axios');

// Configuration
const FIREBASE_FUNCTIONS_URL = 'https://us-central1-website-6889.cloudfunctions.net';
const USER_WALLET = '6qE4UVMQ1iPDxcPn1wV7Ukauj6HPbQ12iHKLPhxXRJN6';
const DUMMY_TOKEN_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

async function testTokenDistribution() {
  console.log('🧪 Testing Token Distribution Function');
  console.log('====================================');
  console.log('');
  
  try {
    console.log('📤 Calling distributeTokensToWinners function...');
    console.log(`Winner: ${USER_WALLET}`);
    console.log(`Amount: 100 DUMMY tokens`);
    console.log(`Token Mint: ${DUMMY_TOKEN_MINT}`);
    console.log('');
    
    const response = await axios.post(`${FIREBASE_FUNCTIONS_URL}/distributeTokensToWinners`, {
      data: {
        gameId: 'test-game-' + Date.now(),
        winners: [USER_WALLET],
        tokenAmountPerWinner: 100,
        tokenMint: DUMMY_TOKEN_MINT
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
    
    console.log('✅ Function Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.result?.success) {
      console.log('');
      console.log('🎉 Token distribution test SUCCESSFUL!');
      console.log('💰 Check your wallet for 100 DUMMY tokens');
    } else {
      console.log('');
      console.log('❌ Token distribution test FAILED');
      console.log('Error:', response.data);
    }
    
  } catch (error) {
    console.error('❌ Error testing token distribution:', error.response?.data || error.message);
  }
}

// Run the test
testTokenDistribution().catch(console.error); 