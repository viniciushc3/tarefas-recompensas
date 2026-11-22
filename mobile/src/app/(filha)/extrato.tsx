import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import { carregarExtrato, carregarSaldo } from '@/lib/api';
import type { LedgerEntry } from '@/lib/types';
import { esp, useCores } from '@/lib/tema';
import {
  Aviso, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo, Vazio,
} from '@/componentes/ui';

/**
 * De onde vieram os pontos. Existe para ela conseguir responder sozinha
 * "por que eu tenho 120 pontos?" — e para você corrigir sem bagunçar nada.
 */
export default function Extrato() {
  const { profile, sair } = useSessao();
  const c = useCores();

  const [itens, setItens] = useState<LedgerEntry[]>([]);
  const [saldo, setSaldo] = useState({ spendable: 0, savings: 0 });
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!profile) return;
    setErro(null);
    try {
      const [ext, bal] = await Promise.all([
        carregarExtrato(profile.id, 100), carregarSaldo(profile.id),
      ]);
      setItens(ext);
      setSaldo({ spendable: bal.spendable, savings: bal.savings });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  if (carregando) return <Carregando />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: esp.lg, gap: esp.lg, paddingBottom: esp.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={async () => { setAtualizando(true); await carregar(); setAtualizando(false); }}
            tintColor={c.primaria}
          />
        }>
        <Titulo>Extrato 🧾</Titulo>
        {erro ? <Aviso mensagem={erro} /> : null}

        <Linha style={{ gap: esp.md }}>
          <Cartao style={{ flex: 1, gap: 2 }}>
            <Subtitulo>GASTÁVEL</Subtitulo>
            <Texto style={{ fontSize: 24, fontWeight: '800', color: c.primaria }}>{saldo.spendable}</Texto>
          </Cartao>
          <Cartao style={{ flex: 1, gap: 2 }}>
            <Subtitulo>COFRINHO</Subtitulo>
            <Texto style={{ fontSize: 24, fontWeight: '800', color: c.cofrinho }}>{saldo.savings}</Texto>
          </Cartao>
        </Linha>

        {itens.length === 0 ? (
          <Vazio emoji="🧾" titulo="Nada ainda" descricao="Faça uma tarefa e ela aparece aqui." />
        ) : (
          <View style={{ gap: esp.sm }}>
            {itens.map((e) => (
              <Cartao key={e.id} style={{ gap: esp.xs }}>
                <Linha style={{ justifyContent: 'space-between', gap: esp.md }}>
                  <Texto numberOfLines={2} style={{ flex: 1, fontWeight: '600' }}>{e.reason}</Texto>
                  <View style={{ alignItems: 'flex-end' }}>
                    {e.spendable_delta !== 0 ? (
                      <Texto style={{ fontWeight: '800', color: e.spendable_delta > 0 ? c.sucesso : c.erro }}>
                        {e.spendable_delta > 0 ? '+' : ''}{e.spendable_delta}
                      </Texto>
                    ) : null}
                    {e.savings_delta !== 0 ? (
                      <Texto style={{ fontWeight: '700', fontSize: 13, color: c.cofrinho }}>
                        {e.savings_delta > 0 ? '+' : ''}{e.savings_delta} cofrinho
                      </Texto>
                    ) : null}
                  </View>
                </Linha>
                <Linha style={{ gap: esp.sm }}>
                  <Chip texto={rotuloDoTipo(e.kind)} />
                  <Texto fraco style={{ fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </Texto>
                </Linha>
              </Cartao>
            ))}
          </View>
        )}

        <Botao
          titulo="Sair desta conta"
          variante="neutro"
          onPress={() =>
            Alert.alert('Sair?', 'Você vai precisar da senha para entrar de novo.', [
              { text: 'Ficar', style: 'cancel' },
              { text: 'Sair', style: 'destructive', onPress: () => void sair() },
            ])
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function rotuloDoTipo(kind: LedgerEntry['kind']): string {
  return { earn: 'tarefa', spend: 'resgate', refund: 'devolução', adjust: 'ajuste' }[kind];
}
