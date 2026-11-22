import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import {
  carregarPerfis, carregarSaldo, decidirOcorrencia, decidirResgate, filaDeAprovacao,
  marcarEntregue, resgatesPendentes, tarefasPorTrasDoResgate,
} from '@/lib/api';
import { rotuloDoDia } from '@/lib/datas';
import type { Occurrence, Profile, Redemption } from '@/lib/types';
import { esp, raio, useCores } from '@/lib/tema';
import {
  Aviso, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo, Vazio,
} from '@/componentes/ui';
import { FotoDaProva } from '@/componentes/FotoDaProva';

export default function Fila() {
  const { hoje } = useSessao();
  const c = useCores();

  const [tarefas, setTarefas] = useState<Occurrence[]>([]);
  const [resgates, setResgates] = useState<Redemption[]>([]);
  const [filhos, setFilhos] = useState<Profile[]>([]);
  const [saldos, setSaldos] = useState<Record<string, { spendable: number; savings: number }>>({});
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [occ, res, perfis] = await Promise.all([
        filaDeAprovacao(), resgatesPendentes(), carregarPerfis(),
      ]);
      const criancas = perfis.filter((p) => p.role === 'child');
      const bal = await Promise.all(criancas.map((p) => carregarSaldo(p.id)));

      setTarefas(occ);
      setResgates(res);
      setFilhos(criancas);
      setSaldos(Object.fromEntries(bal.map((b) => [b.profile_id, { spendable: b.spendable, savings: b.savings }])));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  async function agir<T>(chave: string, acao: () => Promise<T>) {
    setOcupado(chave);
    try {
      await acao();
      await carregar();
    } catch (e) {
      Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  if (carregando) return <Carregando />;

  const nada = tarefas.length === 0 && resgates.length === 0;

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
          <Titulo>Fila 📥</Titulo>
          {filhos.map((f) => {
            const s = saldos[f.id];
            return s ? (
              <Texto fraco key={f.id}>
                {f.display_name}: {s.spendable} para gastar · {s.savings} no cofrinho
              </Texto>
            ) : null;
          })}
        </View>

        {erro ? <Aviso mensagem={erro} /> : null}

        {nada ? (
          <Vazio emoji="☕" titulo="Nada esperando" descricao="Quando ela marcar algo ou pedir uma recompensa, aparece aqui." />
        ) : null}

        {resgates.length > 0 ? (
          <View style={{ gap: esp.md }}>
            <View style={{ gap: 2 }}>
              <Subtitulo>RECOMPENSAS PEDIDAS</Subtitulo>
              <Texto fraco style={{ fontSize: 13 }}>
                Veja o que ela fez antes de liberar.
              </Texto>
            </View>
            {resgates.map((r) => (
              <CartaoDeResgate
                key={r.id}
                resgate={r}
                hoje={hoje}
                ocupado={ocupado === r.id}
                onAprovar={() => void agir(r.id, () => decidirResgate(r.id, true))}
                onRecusar={() => void agir(r.id, () => decidirResgate(r.id, false))}
                onEntregue={() => void agir(r.id, () => marcarEntregue(r.id))}
              />
            ))}
          </View>
        ) : null}

        {tarefas.length > 0 ? (
          <View style={{ gap: esp.md }}>
            <Subtitulo>TAREFAS AGUARDANDO</Subtitulo>
            {tarefas.map((o) => (
              <Cartao key={o.id} style={{ gap: esp.md }}>
                <Linha style={{ gap: esp.md }}>
                  <Text style={{ fontSize: 26 }}>{o.icon_snapshot ?? '⭐'}</Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Texto style={{ fontWeight: '700' }}>{o.title_snapshot}</Texto>
                    <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
                      <Chip texto={rotuloDoDia(o.local_date, hoje)} />
                      {o.points_snapshot > 0 ? (
                        <Chip texto={`+${o.points_snapshot}`} cor={c.primaria} fundo={c.primariaFraca} />
                      ) : (
                        <Chip texto="dever" />
                      )}
                      {o.local_date !== hoje ? (
                        <Chip texto="marcada em atraso" cor={c.alerta} fundo={c.alertaFraco} />
                      ) : null}
                    </Linha>
                  </View>
                </Linha>

                {o.photo_path ? <FotoDaProva caminho={o.photo_path} /> : null}

                <Linha style={{ gap: esp.sm }}>
                  <Botao
                    titulo="Aprovar"
                    variante="sucesso"
                    style={{ flex: 1 }}
                    carregando={ocupado === o.id}
                    onPress={() => void agir(o.id, () => decidirOcorrencia(o.id, true))}
                  />
                  <Botao
                    titulo="Recusar"
                    variante="neutro"
                    style={{ flex: 1 }}
                    carregando={ocupado === o.id}
                    onPress={() =>
                      Alert.alert('Recusar?', 'Ela poderá marcar de novo dentro do prazo.', [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Recusar',
                          style: 'destructive',
                          onPress: () => void agir(o.id, () => decidirOcorrencia(o.id, false)),
                        },
                      ])
                    }
                  />
                </Linha>
              </Cartao>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * O resgate com as tarefas por trás dele.
 *
 * Como a liberação de tela é manual e analisada, aprovar "30 min" sem ver o que
 * ela fez seria aprovar no escuro. Aqui ficam as tarefas aprovadas desde o
 * resgate anterior.
 */
function CartaoDeResgate({
  resgate, hoje, ocupado, onAprovar, onRecusar, onEntregue,
}: {
  resgate: Redemption;
  hoje: string;
  ocupado: boolean;
  onAprovar: () => void;
  onRecusar: () => void;
  onEntregue: () => void;
}) {
  const c = useCores();
  const [porTras, setPorTras] = useState<Occurrence[] | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    tarefasPorTrasDoResgate(resgate)
      .then((r) => { if (vivo) setPorTras(r.ocorrencias); })
      .catch(() => { if (vivo) setPorTras([]); });
    return () => { vivo = false; };
  }, [resgate]);

  const pontosMostrados = (porTras ?? []).reduce((s, o) => s + o.points_snapshot, 0);
  const aprovado = resgate.status === 'approved';

  return (
    <Cartao style={{ gap: esp.md }}>
      <Linha style={{ justifyContent: 'space-between', gap: esp.md }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Texto style={{ fontWeight: '700', fontSize: 18 }}>{resgate.title_snapshot}</Texto>
          <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
            <Chip
              texto={`−${resgate.cost_snapshot} ${resgate.bucket_snapshot === 'savings' ? 'do cofrinho' : 'pontos'}`}
              cor={c.primaria}
              fundo={c.primariaFraca}
            />
            {resgate.screen_minutes_snapshot ? (
              <Chip texto={`${resgate.screen_minutes_snapshot} min de tela`} />
            ) : null}
            {aprovado ? <Chip texto="aprovado" cor={c.sucesso} fundo={c.sucessoFraco} /> : null}
          </Linha>
        </View>
      </Linha>

      {porTras === null ? (
        <Texto fraco style={{ fontSize: 13 }}>Carregando o que ela fez…</Texto>
      ) : porTras.length === 0 ? (
        <Aviso tom="alerta" mensagem="Nenhuma tarefa nova desde o último resgate." />
      ) : (
        <View
          style={{ backgroundColor: c.cartaoFundo, borderRadius: raio.md, padding: esp.md, gap: esp.sm }}>
          <Linha style={{ justifyContent: 'space-between' }}>
            <Subtitulo>O QUE ELA FEZ ({porTras.length})</Subtitulo>
            <Texto style={{ fontWeight: '800', color: c.primaria }}>{pontosMostrados} pts</Texto>
          </Linha>

          {(aberto ? porTras : porTras.slice(0, 4)).map((o) => (
            <Linha key={o.id} style={{ justifyContent: 'space-between', gap: esp.sm }}>
              <Linha style={{ flex: 1, gap: esp.sm }}>
                <Text style={{ fontSize: 15 }}>{o.icon_snapshot ?? '⭐'}</Text>
                <Texto numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{o.title_snapshot}</Texto>
              </Linha>
              <Texto fraco style={{ fontSize: 12 }}>{rotuloDoDia(o.local_date, hoje)}</Texto>
            </Linha>
          ))}

          {porTras.length > 4 ? (
            <Botao
              titulo={aberto ? 'Mostrar menos' : `Ver todas (+${porTras.length - 4})`}
              variante="neutro"
              onPress={() => setAberto((a) => !a)}
            />
          ) : null}
        </View>
      )}

      {aprovado ? (
        <>
          <Texto fraco style={{ fontSize: 13 }}>
            Libere no controle parental e marque aqui quando tiver feito.
          </Texto>
          <Botao titulo="Já liberei" variante="sucesso" carregando={ocupado} onPress={onEntregue} />
        </>
      ) : (
        <Linha style={{ gap: esp.sm }}>
          <Botao titulo="Aprovar" variante="sucesso" style={{ flex: 1 }} carregando={ocupado} onPress={onAprovar} />
          <Botao
            titulo="Recusar"
            variante="neutro"
            style={{ flex: 1 }}
            carregando={ocupado}
            onPress={() =>
              Alert.alert('Recusar o pedido?', 'Os pontos voltam para ela.', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Recusar', style: 'destructive', onPress: onRecusar },
              ])
            }
          />
        </Linha>
      )}
    </Cartao>
  );
}
