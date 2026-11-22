import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { carregarFamilia, carregarProfile, sincronizarDias } from './api';
import { esvaziarFila } from './fila-offline';
import { hojeNoFuso } from './datas';
import type { Family, Profile } from './types';

type Sessao = {
  carregando: boolean;
  userId: string | null;
  profile: Profile | null;
  familia: Family | null;
  erro: string | null;
  /** 'YYYY-MM-DD' no fuso da família. */
  hoje: string;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  recarregar: () => Promise<void>;
};

const Ctx = createContext<Sessao | null>(null);

export function ProvedorDeSessao({ children }: { children: React.ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [familia, setFamilia] = useState<Family | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const sincronizou = useRef<string | null>(null);

  const carregarContexto = useCallback(async (uid: string) => {
    try {
      const [p, f] = await Promise.all([carregarProfile(uid), carregarFamilia()]);
      setProfile(p);
      setFamilia(f);
      setErro(null);
    } catch (e) {
      // Caso clássico: usuário existe no Auth mas ninguém rodou o seed.
      setErro(
        e instanceof Error && e.message.includes('rows')
          ? 'Esse usuário não tem perfil. Rode supabase/seed.sql com o UUID dele.'
          : e instanceof Error ? e.message : String(e),
      );
    }
  }, []);

  // sessão inicial + reação a login/logout
  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      if (uid) carregarContexto(uid).finally(() => setCarregando(false));
      else setCarregando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      const uid = sessao?.user.id ?? null;
      setUserId(uid);
      if (uid) {
        carregarContexto(uid);
      } else {
        setProfile(null);
        setFamilia(null);
        sincronizou.current = null;
      }
    });

    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [carregarContexto]);

  // Gera os dias e esvazia a fila ao entrar e ao voltar para o app.
  // Uma vez por dia local, não a cada foco: a geração é idempotente mas não
  // precisa de ida ao servidor a cada vez que o celular desbloqueia.
  const sincronizar = useCallback(async () => {
    if (!profile || !familia) return;
    const hoje = hojeNoFuso(familia.timezone);
    try {
      await esvaziarFila();
      if (sincronizou.current !== hoje) {
        await sincronizarDias(14);
        sincronizou.current = hoje;
      }
    } catch {
      // Sem rede: a fila continua guardada e tenta no próximo foco.
    }
  }, [profile, familia]);

  useEffect(() => { void sincronizar(); }, [sincronizar]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void sincronizar();
    });
    return () => sub.remove();
  }, [sincronizar]);

  const valor: Sessao = {
    carregando,
    userId,
    profile,
    familia,
    erro,
    hoje: familia ? hojeNoFuso(familia.timezone) : hojeNoFuso('America/Sao_Paulo'),
    entrar: async (email, senha) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(), password: senha,
      });
      if (error) {
        throw new Error(
          error.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : error.message,
        );
      }
    },
    sair: async () => { await supabase.auth.signOut(); },
    recarregar: async () => { if (userId) await carregarContexto(userId); },
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao(): Sessao {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSessao precisa estar dentro de ProvedorDeSessao');
  return ctx;
}
