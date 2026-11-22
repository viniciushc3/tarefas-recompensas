import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSessao } from '@/lib/sessao';
import { configurado } from '@/lib/supabase';
import { Aviso, Botao, Carregando, Cartao, Texto, Titulo } from '@/componentes/ui';
import { esp, useCores } from '@/lib/tema';

/** Porta de entrada: manda cada um para o seu app. */
export default function Index() {
  const { carregando, userId, profile, erro, sair } = useSessao();
  const c = useCores();

  if (!configurado) return <ConfiguracaoPendente />;
  if (carregando) return <Carregando texto="Carregando…" />;
  if (!userId) return <Redirect href="/entrar" />;

  if (erro) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', gap: esp.lg, padding: esp.lg, backgroundColor: c.fundo }}>
        <Aviso mensagem={erro} />
        <Botao titulo="Sair" variante="neutro" onPress={() => void sair()} />
      </View>
    );
  }

  if (!profile) return <Carregando texto="Carregando perfil…" />;

  return profile.role === 'child'
    ? <Redirect href="/(filha)/hoje" />
    : <Redirect href="/(pai)/fila" />;
}

/** Primeira coisa que acontece num setup novo: ainda não há projeto Supabase. */
function ConfiguracaoPendente() {
  const c = useCores();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: esp.lg, gap: esp.lg, backgroundColor: c.fundo }}>
      <Titulo>Falta conectar 🔌</Titulo>
      <Cartao style={{ gap: esp.sm }}>
        <Texto>
          Crie o arquivo <Texto style={{ fontWeight: '800' }}>.env</Texto> na pasta{' '}
          <Texto style={{ fontWeight: '800' }}>mobile/</Texto> com:
        </Texto>
        <Texto fraco style={{ fontSize: 13 }}>EXPO_PUBLIC_SUPABASE_URL=…</Texto>
        <Texto fraco style={{ fontSize: 13 }}>EXPO_PUBLIC_SUPABASE_ANON_KEY=…</Texto>
        <Texto fraco style={{ fontSize: 13 }}>
          Os dois valores estão no painel do Supabase, em Project Settings → API.
          Depois reinicie o app.
        </Texto>
      </Cartao>
    </View>
  );
}
