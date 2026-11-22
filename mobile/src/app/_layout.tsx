import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { ProvedorDeSessao } from '@/lib/sessao';

export default function RootLayout() {
  const esquema = useColorScheme();
  return (
    <ProvedorDeSessao>
      <ThemeProvider value={esquema === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </ProvedorDeSessao>
  );
}
