import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import { carregarExtrato, carregarRecompensas, carregarSaldo } from '@/lib/api';
import type { LedgerEntry, Reward } from '@/lib/types';
import { esp, raio, useCores } from '@/lib/tema';
import { Aviso, Barra, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo, Vazio } from '@/componentes/ui';

/**
 * A meta grande, financiada só pelo cofrinho.
 *
 * Esta tela é o que dá sentido aos 30% que ela não pode gastar. Sem a barra e
 * sem a previsão, o cofrinho é só um número que não serve para nada.
 */
export default function Meta() {
  const { profile } = useSessao();
  const c = useCores();

  const [meta, setMeta] = useState<Reward | null>(null);
  const [cofrinho, setCofrinho] = useState(0);
  const [extrato, setExtrato] = useState<LedgerEntry[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!profile) return;
    setErro(null);
    try {
      const [rec, bal, ext] = await Promise.all([
        carregarRecompensas(), carregarSaldo(profile.id), carregarExtrato(profile.id, 120),
      ]);
      setMeta(rec.find((r) => r.kind === 'big_prize') ?? null);
      setCofrinho(bal.savings);
      setExtrato(ext);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  /** Ritmo real das últimas semanas, não um número inventado. */
  const previsao = useMemo(() => {
    if (!meta) return null;
    const ganhos = extrato.filter((e) => e.kind === 'earn' && e.savings_delta > 0);
    if (ganhos.length < 3) return null;

    const maisAntigo = new Date(ganhos[ganhos.length - 1].created_at).getTime();
    const dias = Math.max(1, (Date.now() - maisAntigo) / 86400000);
    const porDia = ganhos.reduce((s, e) => s + e.savings_delta, 0) / dias;
    if (porDia <= 0) return null;

    const faltam = Math.max(0, meta.cost_points - cofrinho);
    return { porDia, diasRestantes: Math.ceil(faltam / porDia) };
  }, [extrato, meta, cofrinho]);

  if (carregando) return <Carregando />;

  if (!meta) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }} edges={['top']}>
        <Vazio
          emoji="🎯"
          titulo="Nenhuma meta ainda"
          descricao="Combine com seu pai qual vai ser o prêmio grande."
        />
      </SafeAreaView>
    );
  }

  const fracao = cofrinho / meta.cost_points;
  const faltam = Math.max(0, meta.cost_points - cofrinho);
  const conquistada = faltam === 0;

  const doCofrinho = extrato.filter((e) => e.savings_delta !== 0).slice(0, 12);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: esp.lg, gap: esp.xl, paddingBottom: esp.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={async () => { setAtualizando(true); await carregar(); setAtualizando(false); }}
            tintColor={c.cofrinho}
          />
        }>
        <Titulo>Minha meta 🎯</Titulo>
        {erro ? <Aviso mensagem={erro} /> : null}

        <View
          style={{
            backgroundColor: c.cofrinhoFraco, borderRadius: raio.lg, padding: esp.xl, gap: esp.md,
            alignItems: 'center',
          }}>
          <Text style={{ fontSize: 64 }}>{meta.icon ?? '🚲'}</Text>
          <Texto style={{ fontWeight: '800', fontSize: 20, textAlign: 'center', color: c.cofrinho }}>
            {meta.title}
          </Texto>

          <View style={{ width: '100%', gap: esp.sm }}>
            <Barra fracao={fracao} cor={c.cofrinho} altura={18} />
            <Linha style={{ justifyContent: 'space-between' }}>
              <Texto style={{ fontWeight: '800', color: c.cofrinho, fontSize: 18 }}>
                {cofrinho}
              </Texto>
              <Texto style={{ color: c.cofrinho, opacity: 0.8 }}>de {meta.cost_points}</Texto>
            </Linha>
          </View>

          {conquistada ? (
            <Chip texto="🎉 conquistada! peça na loja" cor={c.sucesso} fundo={c.sucessoFraco} />
          ) : (
            <Texto style={{ color: c.cofrinho, fontWeight: '700' }}>faltam {faltam} pontos</Texto>
          )}
        </View>

        {!conquistada && previsao ? (
          <Cartao style={{ gap: esp.xs }}>
            <Subtitulo>NO SEU RITMO</Subtitulo>
            <Texto>
              Você junta cerca de{' '}
              <Texto style={{ fontWeight: '800' }}>{previsao.porDia.toFixed(0)} pontos por dia</Texto>{' '}
              no cofrinho.
            </Texto>
            <Texto fraco>
              Nesse ritmo, faltam mais ou menos{' '}
              {previsao.diasRestantes > 60
                ? `${Math.round(previsao.diasRestantes / 30)} meses`
                : `${previsao.diasRestantes} dias`}.
            </Texto>
          </Cartao>
        ) : null}

        <Cartao style={{ gap: esp.xs }}>
          <Subtitulo>COMO FUNCIONA</Subtitulo>
          <Texto fraco style={{ fontSize: 14 }}>
            De cada tarefa, 30% dos pontos vão direto para o cofrinho e não podem ser
            gastos em tela. É assim que a meta grande acontece sem você precisar se segurar.
          </Texto>
        </Cartao>

        {doCofrinho.length > 0 ? (
          <View style={{ gap: esp.sm }}>
            <Subtitulo>ÚLTIMAS ENTRADAS NO COFRINHO</Subtitulo>
            {doCofrinho.map((e) => (
              <Linha key={e.id} style={{ justifyContent: 'space-between' }}>
                <Texto numberOfLines={1} style={{ flex: 1 }}>{e.reason}</Texto>
                <Texto style={{ fontWeight: '800', color: e.savings_delta > 0 ? c.cofrinho : c.erro }}>
                  {e.savings_delta > 0 ? '+' : ''}{e.savings_delta}
                </Texto>
              </Linha>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
