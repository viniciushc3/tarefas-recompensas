import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSessao } from '@/lib/sessao';
import { Aviso, Botao, Texto, Titulo } from '@/componentes/ui';
import { esp, raio, useCores } from '@/lib/tema';

/**
 * Login só é usado uma vez por aparelho: a sessão fica guardada e o app entra
 * sozinho depois. Ela nunca precisa saber a senha dela.
 */
export default function Entrar() {
  const { userId, entrar } = useSessao();
  const c = useCores();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (userId) return <Redirect href="/" />;

  async function aoEntrar() {
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const campo = {
    backgroundColor: c.cartao,
    borderWidth: 1,
    borderColor: c.borda,
    borderRadius: raio.md,
    padding: esp.md,
    fontSize: 16,
    color: c.texto,
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.fundo }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: esp.xl, gap: esp.lg }}>
        <View style={{ gap: esp.xs }}>
          <Texto style={{ fontSize: 44 }}>🏡</Texto>
          <Titulo>Tarefas</Titulo>
          <Texto fraco>Entre uma vez; depois o app abre sozinho.</Texto>
        </View>

        {erro ? <Aviso mensagem={erro} /> : null}

        <TextInput
          style={campo}
          placeholder="e-mail"
          placeholderTextColor={c.textoFraco}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={campo}
          placeholder="senha"
          placeholderTextColor={c.textoFraco}
          secureTextEntry
          value={senha}
          onChangeText={setSenha}
          onSubmitEditing={() => void aoEntrar()}
        />
        <Botao titulo="Entrar" grande carregando={enviando} onPress={() => void aoEntrar()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
