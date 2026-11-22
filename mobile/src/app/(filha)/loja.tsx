import { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import {
  cancelarResgate, carregarRecompensas, carregarSaldo, pedirResgate, resgatesDela,
} from '@/lib/api';
import { pontosPorMinutoDeTela } from '@/lib/metricas';
import { minutosEquivalentes } from '@/lib/datas';
import type { Redemption, Reward } from '@/lib/types';
import { esp, raio, useCores } from '@/lib/tema';
import {
  Aviso, Barra, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo,
} from '@/componentes/ui';

export default function Loja() {
  const { profile } = useSessao();
  const c = useCores();

  const [recompensas, setRecompensas] = useState<Reward[]>([]);
  const [resgates, setResgates] = useState<Redemption[]>([]);
  const [saldo, setSaldo] = useState({ spendable: 0, savings: 0 });
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!profile) return;
    setErro(null);
    try {
      const [rec, bal, res] = await Promise.all([
        carregarRecompensas(), carregarSaldo(profile.id), resgatesDela(profile.id, 10),
      ]);
      setRecompensas(rec);
      setSaldo({ spendable: bal.spendable, savings: bal.savings });
      setResgates(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  const porMinuto = useMemo(() => pontosPorMinutoDeTela(recompensas), [recompensas]);
  const pendentes = resgates.filter((r) => r.status === 'requested' || r.status === 'approved');

  async function pedir(r: Reward) {
    const saldoDoBucket = r.bucket === 'savings' ? saldo.savings : saldo.spendable;
    Alert.alert(
      r.title,
      `Custa ${r.cost_points} pontos. Você tem ${saldoDoBucket}.\n\nSeu pai precisa confirmar antes de valer.`,
      [
        { text: 'Deixa pra depois', style: 'cancel' },
        {
          text: 'Pedir',
          onPress: async () => {
            setOcupado(r.id);
            try {
              await pedirResgate(r.id);
              await carregar();
            } catch (e) {
              Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
            } finally {
              setOcupado(null);
            }
          },
        },
      ],
    );
  }

  async function cancelar(res: Redemption) {
    setOcupado(res.id);
    try {
      await cancelarResgate(res.id);
      await carregar();
    } catch (e) {
      Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  if (carregando) return <Carregando />;

  const catalogo = recompensas.filter((r) => r.kind !== 'big_prize');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: esp.lg, gap: esp.xl, paddingBottom: esp.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={async () => { setAtualizando(true); await carregar(); setAtualizando(false); }}
            tintColor={c.primaria}
          />
        }>
        <View style={{ gap: esp.xs }}>
          <Titulo>Loja 🎁</Titulo>
          <Texto fraco>
            Você tem <Texto style={{ fontWeight: '800', color: c.primaria }}>{saldo.spendable}</Texto> para gastar
            {porMinuto > 0 ? ` (≈ ${minutosEquivalentes(saldo.spendable, porMinuto)} min de tela)` : ''}
          </Texto>
        </View>

        {erro ? <Aviso mensagem={erro} /> : null}

        {pendentes.length > 0 ? (
          <View style={{ gap: esp.sm }}>
            <Subtitulo>SEUS PEDIDOS</Subtitulo>
            {pendentes.map((r) => (
              <Cartao key={r.id} style={{ gap: esp.sm }}>
                <Linha style={{ justifyContent: 'space-between' }}>
                  <Texto style={{ fontWeight: '700', flex: 1 }}>{r.title_snapshot}</Texto>
                  <Texto style={{ fontWeight: '800', color: c.primaria }}>{r.cost_snapshot}</Texto>
                </Linha>
                {r.status === 'requested' ? (
                  <>
                    <Chip texto="⏳ esperando seu pai confirmar" cor={c.alerta} fundo={c.alertaFraco} />
                    <Texto fraco style={{ fontSize: 13 }}>
                      Os pontos já saíram do seu saldo. Se ele recusar, eles voltam.
                    </Texto>
                    <Botao
                      titulo="Desistir e pegar os pontos de volta"
                      variante="neutro"
                      carregando={ocupado === r.id}
                      onPress={() => void cancelar(r)}
                    />
                  </>
                ) : (
                  <Chip texto="✅ aprovado — é só combinar com ele" cor={c.sucesso} fundo={c.sucessoFraco} />
                )}
              </Cartao>
            ))}
          </View>
        ) : null}

        <View style={{ gap: esp.sm }}>
          <Subtitulo>O QUE VOCÊ PODE PEDIR</Subtitulo>
          {catalogo.map((r) => {
            const saldoDoBucket = r.bucket === 'savings' ? saldo.savings : saldo.spendable;
            const faltam = r.cost_points - saldoDoBucket;
            const podePedir = faltam <= 0;

            return (
              <Cartao key={r.id} style={{ gap: esp.md }} onPress={podePedir ? () => void pedir(r) : undefined}>
                <Linha style={{ gap: esp.md }}>
                  <Text style={{ fontSize: 30 }}>{r.icon ?? '🎁'}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Texto style={{ fontWeight: '700' }}>{r.title}</Texto>
                    <Texto fraco style={{ fontSize: 13 }}>
                      {r.cost_points} pontos
                      {r.bucket === 'savings' ? ' • do cofrinho' : ''}
                    </Texto>
                  </View>
                  {podePedir ? (
                    <Chip texto="pedir" cor={c.primaria} fundo={c.primariaFraca} />
                  ) : null}
                </Linha>

                {/* Faltando, mostra o quanto falta em vez de cinza bloqueado:
                    dá direção, não bloqueio. */}
                {!podePedir ? (
                  <View style={{ gap: esp.xs }}>
                    <Barra fracao={saldoDoBucket / r.cost_points} altura={8} />
                    <Texto fraco style={{ fontSize: 13 }}>faltam {faltam} pontos</Texto>
                  </View>
                ) : null}
              </Cartao>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
