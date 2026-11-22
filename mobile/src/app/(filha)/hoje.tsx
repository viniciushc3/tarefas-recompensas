import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import { carregarRecompensas, carregarSaldo, enviarFoto, ocorrenciasDoPeriodo } from '@/lib/api';
import { marcarComFila, pendentes } from '@/lib/fila-offline';
import { calcularStreak, pontosPorMinutoDeTela } from '@/lib/metricas';
import { rotuloDoDia, somarDias } from '@/lib/datas';
import { PERIOD_LABEL, PERIOD_ORDER, type Occurrence, type Reward } from '@/lib/types';
import { esp, raio, useCores } from '@/lib/tema';
import { Aviso, Carregando, Chip, Linha, Subtitulo, Texto, Titulo, Vazio } from '@/componentes/ui';
import { CabecalhoSaldo } from '@/componentes/CabecalhoSaldo';

export default function Hoje() {
  const { profile, familia, hoje } = useSessao();
  const c = useCores();

  const [ocorrencias, setOcorrencias] = useState<Occurrence[]>([]);
  const [recompensas, setRecompensas] = useState<Reward[]>([]);
  const [saldo, setSaldo] = useState({ spendable: 0, savings: 0 });
  const [naFila, setNaFila] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupadas, setOcupadas] = useState<string[]>([]);

  const janela = familia?.late_window_days ?? 2;

  const carregar = useCallback(async () => {
    if (!profile) return;
    setErro(null);
    try {
      // 30 dias para o streak; a tela mostra só a janela de atraso.
      const [occ, rec, bal, fila] = await Promise.all([
        ocorrenciasDoPeriodo(somarDias(hoje, -30), hoje),
        carregarRecompensas(),
        carregarSaldo(profile.id),
        pendentes(),
      ]);
      setOcorrencias(occ);
      setRecompensas(rec);
      setSaldo({ spendable: bal.spendable, savings: bal.savings });
      setNaFila(fila);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [profile, hoje]);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  const streak = useMemo(() => calcularStreak(ocorrencias, hoje), [ocorrencias, hoje]);
  const porMinuto = useMemo(() => pontosPorMinutoDeTela(recompensas), [recompensas]);
  const metaGrande = useMemo(() => recompensas.find((r) => r.kind === 'big_prize'), [recompensas]);

  const deHoje = useMemo(
    () => ocorrencias.filter((o) => o.local_date === hoje),
    [ocorrencias, hoje],
  );

  /** Dias anteriores que ainda têm tarefa marcável: "esqueceu de marcar?" */
  const atrasadas = useMemo(() => {
    const limite = somarDias(hoje, -janela);
    const lista = ocorrencias.filter(
      (o) => o.local_date < hoje && o.local_date >= limite &&
             (o.status === 'pending' || o.status === 'rejected'),
    );
    const dias = [...new Set(lista.map((o) => o.local_date))].sort().reverse();
    return dias.map((dia) => ({ dia, itens: lista.filter((o) => o.local_date === dia) }));
  }, [ocorrencias, hoje, janela]);

  async function tirarFoto(): Promise<ArrayBuffer | null> {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Precisa da câmera', 'Essa tarefa pede uma foto para comprovar.');
      return null;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (r.canceled || !r.assets[0]) return null;
    const resposta = await fetch(r.assets[0].uri);
    return resposta.arrayBuffer();
  }

  async function aoMarcar(occ: Occurrence) {
    if (!profile || ocupadas.includes(occ.id)) return;
    setOcupadas((a) => [...a, occ.id]);

    const otimista: Occurrence['status'] = occ.requires_approval_snapshot ? 'claimed' : 'approved';
    const anterior = occ.status;
    setOcorrencias((lista) =>
      lista.map((o) => (o.id === occ.id ? { ...o, status: otimista } : o)));

    function reverter(mensagem?: string) {
      setOcorrencias((lista) =>
        lista.map((o) => (o.id === occ.id ? { ...o, status: anterior } : o)));
      if (mensagem) Alert.alert('Não deu', mensagem);
    }

    try {
      let fotoPath: string | undefined;

      if (occ.requires_photo_snapshot) {
        const arquivo = await tirarFoto();
        if (!arquivo) { reverter(); return; }
        try {
          fotoPath = await enviarFoto(profile.id, occ.id, arquivo);
        } catch {
          // Foto exige rede: enfileirar sem a foto faria a marcação ser recusada.
          reverter('A foto precisa de internet. Marque essa tarefa quando estiver conectada.');
          return;
        }
      }

      const r = await marcarComFila(occ.id, fotoPath);
      if (r.erroDeRegra) { reverter(r.erroDeRegra); return; }
      if (!r.sincronizado) {
        setNaFila((a) => [...a, occ.id]);   // ficou na fila local
      } else if (otimista === 'approved' && occ.points_snapshot > 0) {
        // Crédito imediato: mostra o saldo subindo sem esperar o servidor.
        const cofre = Math.floor(occ.points_snapshot * (familia?.savings_rate ?? 0.3));
        setSaldo((s) => ({
          spendable: s.spendable + (occ.points_snapshot - cofre),
          savings: s.savings + cofre,
        }));
      }
    } finally {
      setOcupadas((a) => a.filter((id) => id !== occ.id));
    }
  }

  if (carregando) return <Carregando />;

  const feitasHoje = deHoje.filter((o) => o.status === 'approved' || o.status === 'claimed').length;

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
          <Titulo>Oi, {profile?.display_name} {profile?.avatar_emoji}</Titulo>
          <Texto fraco>
            {deHoje.length === 0
              ? 'Nenhuma tarefa hoje.'
              : `${feitasHoje} de ${deHoje.length} tarefas de hoje`}
          </Texto>
        </View>

        <CabecalhoSaldo
          gastavel={saldo.spendable}
          cofrinho={saldo.savings}
          pontosPorMinuto={porMinuto}
          streak={streak}
          metaPontos={metaGrande?.cost_points ?? null}
        />

        {erro ? <Aviso mensagem={erro} /> : null}
        {naFila.length > 0 ? (
          <Aviso
            tom="alerta"
            mensagem={`${naFila.length} ${naFila.length === 1 ? 'marcação' : 'marcações'} esperando internet. Já está salvo, vai sincronizar sozinho.`}
          />
        ) : null}

        {deHoje.length === 0 ? (
          <Vazio emoji="🌤️" titulo="Dia livre!" descricao="Nenhuma tarefa marcada para hoje." />
        ) : (
          PERIOD_ORDER.map((periodo) => {
            const itens = deHoje.filter((o) => o.period_snapshot === periodo);
            if (itens.length === 0) return null;
            return (
              <View key={periodo} style={{ gap: esp.sm }}>
                <Subtitulo>{PERIOD_LABEL[periodo].toUpperCase()}</Subtitulo>
                {itens.map((o) => (
                  <ItemTarefa
                    key={o.id}
                    occ={o}
                    ocupada={ocupadas.includes(o.id)}
                    naFila={naFila.includes(o.id)}
                    onMarcar={() => void aoMarcar(o)}
                  />
                ))}
              </View>
            );
          })
        )}

        {atrasadas.length > 0 ? (
          <View style={{ gap: esp.md }}>
            <View style={{ gap: 2 }}>
              <Subtitulo>ESQUECEU DE MARCAR?</Subtitulo>
              <Texto fraco style={{ fontSize: 13 }}>
                Você ainda pode marcar o que fez nos últimos {janela} dias.
              </Texto>
            </View>
            {atrasadas.map(({ dia, itens }) => (
              <View key={dia} style={{ gap: esp.sm }}>
                <Chip texto={rotuloDoDia(dia, hoje)} />
                {itens.map((o) => (
                  <ItemTarefa
                    key={o.id}
                    occ={o}
                    atrasada
                    ocupada={ocupadas.includes(o.id)}
                    naFila={naFila.includes(o.id)}
                    onMarcar={() => void aoMarcar(o)}
                  />
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ItemTarefa({
  occ, onMarcar, ocupada, naFila, atrasada,
}: {
  occ: Occurrence;
  onMarcar: () => void;
  ocupada: boolean;
  naFila: boolean;
  atrasada?: boolean;
}) {
  const c = useCores();
  const feita = occ.status === 'approved';
  const esperando = occ.status === 'claimed';
  const recusada = occ.status === 'rejected';
  const marcavel = occ.status === 'pending' || recusada;

  const fundo = feita ? c.sucessoFraco : esperando ? c.alertaFraco : c.cartao;
  const borda = feita ? c.sucesso : esperando ? c.alerta : recusada ? c.erro : c.borda;

  return (
    <Pressable
      onPress={marcavel ? onMarcar : undefined}
      disabled={!marcavel || ocupada}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: esp.md,
        backgroundColor: fundo,
        borderRadius: raio.lg,
        borderWidth: 1.5,
        borderColor: borda,
        padding: esp.lg,
        opacity: ocupada ? 0.5 : pressed ? 0.75 : 1,
      })}>
      {/* Caixa grande de propósito: o alvo precisa ser fácil para dedo de criança. */}
      <View
        style={{
          width: 34, height: 34, borderRadius: 10,
          borderWidth: 2.5,
          borderColor: feita ? c.sucesso : esperando ? c.alerta : c.borda,
          backgroundColor: feita ? c.sucesso : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
        {feita ? <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '900' }}>✓</Text> : null}
        {esperando ? <Text style={{ fontSize: 16 }}>⏳</Text> : null}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Linha style={{ gap: esp.sm }}>
          <Text style={{ fontSize: 20 }}>{iconeDe(occ)}</Text>
          <Texto
            numberOfLines={2}
            style={{
              flex: 1, fontWeight: '600',
              textDecorationLine: feita ? 'line-through' : 'none',
              color: feita ? c.textoFraco : c.texto,
            }}>
            {occ.title_snapshot}
          </Texto>
        </Linha>

        <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
          {occ.points_snapshot > 0 ? (
            <Chip texto={`+${occ.points_snapshot}`} cor={c.primaria} fundo={c.primariaFraca} />
          ) : (
            <Chip texto="dever" />
          )}
          {occ.requires_photo_snapshot && marcavel ? <Chip texto="📷 foto" /> : null}
          {esperando ? <Chip texto="esperando confirmação" cor={c.alerta} fundo={c.alertaFraco} /> : null}
          {recusada ? <Chip texto="recusada — pode marcar de novo" cor={c.erro} fundo={c.erroFraco} /> : null}
          {naFila ? <Chip texto="⏱ vai sincronizar" cor={c.alerta} fundo={c.alertaFraco} /> : null}
          {atrasada && marcavel ? <Chip texto="atrasada" cor={c.alerta} fundo={c.alertaFraco} /> : null}
        </Linha>
      </View>
    </Pressable>
  );
}

/** O emoji é como ela identifica a tarefa antes de ler o texto. */
function iconeDe(occ: Occurrence): string {
  return occ.icon_snapshot ?? (occ.kind_snapshot === 'basic' ? '🫧' : '⭐');
}
