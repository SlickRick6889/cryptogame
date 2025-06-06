# 🎮 STAYPOOL - Token-Backed Survival Game

> **Stay alert, stay alive, win the pool!** The ultimate crypto survival game on Solana.

STAYPOOL is a revolutionary token-backed survival game where participants must stay alert and click "Stay In" to avoid elimination. The last wallet standing wins a big chunk of the prize pool, which is held in Pump.fun-launched tokens.

## 🚀 Features

- **Token-Backed Prize Pool**: Entry fees buy tokens that create the prize pool
- **Real-Time Elimination**: Random player selection with countdown timers
- **Solana Integration**: Full wallet adapter support with Phantom, Solflare, and Backpack
- **Modern UI/UX**: Gaming-focused dark theme with neon accents
- **Firebase Backend**: Real-time game state with Firestore
- **Mobile Responsive**: Optimized for all devices

## 🎯 How It Works

1. **Connect & Pay**: Connect your Solana wallet and pay the entry fee (SOL)
2. **Token Purchase**: Your SOL automatically buys tokens on Pump.fun via Jupiter
3. **Prize Pool**: Purchased tokens are transferred to the game prize wallet
4. **Survival Phase**: Players are randomly selected for elimination rounds
5. **Stay Alert**: Click "Stay In" within 10 seconds when selected or be eliminated
6. **Winner Takes All**: Last player standing wins 90% of the token prize pool

## 🛠 Tech Stack

- **Frontend**: Next.js 14 + TypeScript + TailwindCSS
- **Blockchain**: Solana Web3.js + Wallet Adapter
- **Backend**: Firebase Functions + Firestore
- **UI Library**: Framer Motion + Lucide React
- **Styling**: Custom gaming theme with neon effects

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Firebase account
- Solana wallet (Phantom, Solflare, or Backpack)

### Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd staypool-game
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Variables**
   Create a `.env.local` file in the root directory:
   ```env
   # Solana Configuration
   NEXT_PUBLIC_SOLANA_RPC_HOST=https://api.devnet.solana.com
   
   # Firebase Configuration
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   
   # Game Configuration
   NEXT_PUBLIC_TOKEN_MINT_ADDRESS=your_token_mint_address
   NEXT_PUBLIC_PRIZE_WALLET_ADDRESS=your_prize_wallet_address
   ```

4. **Firebase Setup**
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) with your browser.

## 🔧 Configuration

### Token Setup
1. Launch your token on [Pump.fun](https://pump.fun)
2. Add the token mint address to your environment variables
3. Set up a prize wallet to hold the token pool
4. Configure Jupiter integration for automatic token purchases

### Firebase Setup
1. Create a new Firebase project
2. Enable Firestore Database
3. Enable Firebase Functions
4. Configure authentication (optional for wallet-based auth)
5. Deploy security rules: `firebase deploy --only firestore:rules`

## 🎮 Game Mechanics

### Entry System
- **Entry Fee**: 0.01 SOL (configurable)
- **Token Purchase**: Automatic via Jupiter API
- **Prize Pool**: Tokens accumulate in prize wallet

### Elimination Rules
- **Random Selection**: Players selected randomly for elimination rounds
- **Time Limit**: 10 seconds to respond (configurable)
- **Auto-Elimination**: Missing your turn = instant elimination
- **Winner Selection**: Last active player wins

### Prize Distribution
- **Winner**: 90% of prize pool tokens
- **Development Fund**: 10% for platform maintenance
- **Instant Transfer**: Automated token distribution

## 🏗 Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── globals.css        # Global styles and Tailwind
│   ├── layout.tsx         # Root layout with providers
│   └── page.tsx           # Main homepage
├── components/            # React components
│   ├── GameArena.tsx      # Active game interface
│   ├── GameLobby.tsx      # Pre-game waiting room
│   ├── GameResults.tsx    # Post-game results
│   └── Providers.tsx      # Context providers wrapper
├── contexts/              # React contexts
│   ├── FirebaseContext.tsx # Firebase connection
│   └── GameContext.tsx    # Game state management
└── lib/                   # Utility functions
    ├── firebase.ts        # Firebase configuration
    ├── solana.ts          # Solana utilities
    └── jupiter.ts         # Jupiter swap integration
```

## 🚀 Deployment

### Frontend (Vercel)
```bash
npm run build
# Deploy to Vercel, Netlify, or similar
```

### Backend (Firebase)
```bash
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

## 🔐 Security

- **Wallet Security**: Non-custodial, users control their own wallets
- **Smart Contract**: Minimal on-chain footprint, mainly token transfers
- **Firebase Rules**: Strict read/write permissions
- **Input Validation**: All user inputs validated and sanitized

## 🎨 Customization

### Styling
- Modify `tailwind.config.js` for custom colors and animations
- Update `globals.css` for gaming theme adjustments
- Components use CSS-in-JS with Tailwind classes

### Game Parameters
```typescript
// In GameContext.tsx
const initialState = {
  entryFee: 0.01,           // SOL
  eliminationTimer: 10,     // seconds
  minPlayers: 3,            // minimum to start
  maxPlayers: 20,           // maximum capacity
  // ... other settings
}
```

## 📋 Roadmap

- [ ] **Phase 1**: Core game mechanics ✅
- [ ] **Phase 2**: Token integration and Jupiter swaps
- [ ] **Phase 3**: Leaderboards and player statistics
- [ ] **Phase 4**: Spectator mode and live streaming
- [ ] **Phase 5**: Tournament system and scheduled games
- [ ] **Phase 6**: NFT rewards and achievements
- [ ] **Phase 7**: Mobile app (React Native)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Discord**: Join our community for real-time support
- **Email**: Support at your-email@domain.com

## ⚠️ Disclaimer

This is a demo/educational project. Use at your own risk. Cryptocurrency gaming involves risk of loss. Only play with amounts you can afford to lose. This is not financial advice.

---

**Built with ❤️ for the Solana ecosystem**

*STAYPOOL - Where reflexes meet rewards!* 🎮⚡ 