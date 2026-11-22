import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Se faltar configuração, NÃO lançamos erro aqui: um throw no import derruba o
 * app com tela vermelha antes de qualquer coisa renderizar, e também quebra o
 * build. Em vez disso a interface mostra o que falta fazer.
 */
export const configurado = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? 'https://configuracao-pendente.supabase.co',
  anonKey ?? 'chave-pendente',
  {
    auth: {
      // A sessão fica no aparelho: ela nunca digita senha.
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
