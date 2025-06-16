import '@solana/wallet-adapter-react-ui/styles.css';
import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { AppProviders } from '../components/Providers';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AppProviders>
      <Component {...pageProps} />
    </AppProviders>
  );
}

export default MyApp; 