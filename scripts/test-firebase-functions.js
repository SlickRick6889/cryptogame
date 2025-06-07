const axios = require('axios');

const FIREBASE_FUNCTIONS_URL = 'https://us-central1-website-6889.cloudfunctions.net';

async function testFunction() {
  console.log('🧪 Testing Firebase Functions (Devnet)');
  console.log('=====================================');
  
  try {
    console.log('0. Testing basic function...');
    
    const response = await axios.post(`${FIREBASE_FUNCTIONS_URL}/testFunction`, {
      data: {} // Firebase callable functions expect data wrapper
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Test Function Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing basic function:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  }
}

async function testTreasuryStatus() {
  console.log('🧪 Testing Firebase Functions (Devnet)');
  console.log('=====================================');
  
  try {
    console.log('1. Testing getTreasuryStatus...');
    
    const response = await axios.post(`${FIREBASE_FUNCTIONS_URL}/getTreasuryStatus`, {
      data: {} // Firebase callable functions expect data wrapper
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Treasury Status Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing treasury status:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  }
}

async function testManualTokenPurchase() {
  console.log('\n2. Testing manual token purchase...');
  
  try {
    const response = await axios.post(`${FIREBASE_FUNCTIONS_URL}/buyTokensManually`, {
      data: { solAmount: 0.05 } // Test with 0.05 SOL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Manual Purchase Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing manual purchase:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  }
}

async function runTests() {
  await testFunction();
  await testTreasuryStatus();
  await testManualTokenPurchase();
  
  console.log('\n🎯 Devnet Testing Summary:');
  console.log('================================');
  console.log('📍 Treasury Wallet: 5RM2ALYEPFSXUfuYfBiZtg4fxfvm6XMa7Mgyjkjk5We4');
  console.log('🪙 Test Token: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (USDC-Dev)');
  console.log('🌐 Website: https://website-6889.web.app');
  console.log('');
  console.log('📋 Next Steps:');
  console.log('1. Visit website and connect devnet wallet');
  console.log('2. Try joining game (should require wallet connection)');
  console.log('3. Send small amount of SOL to treasury to test auto-purchase');
}

runTests(); 