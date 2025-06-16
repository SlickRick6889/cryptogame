import '@solana/wallet-adapter-react-ui/styles.css';
import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { AppProviders } from '../components/Providers';
import { GameProvider } from '../context/GameContext';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AppProviders>
      <GameProvider>
        <Component {...pageProps} />
      </GameProvider>
    </AppProviders>
  );
}

export default MyApp; 