import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSessao } from '@/lib/sessao';
import {
  ajustarPontos, carregarFaixas, carregarFechamentos, carregarPerfis,
  fecharSemana, marcarSemanaPaga, ocorrenciasDoPeriodo,
} from '@/lib/api';
import { faixaAlcancada, proximaFaixa, resumoDaSemana, tarefasParaAlcancar } from '@/lib/metricas';
import { formatarReais, inicioDaSemana, somarDias } from '@/lib/datas';
import type { AllowanceTier, Occurrence, Profile, WeeklyClosing } from '@/lib/types';
import { esp, useCores } from '@/lib/tema';
import {
  Aviso, Barra, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo,
} from '@/componentes/ui';
import { CampoTexto } from '@/componentes/Campo';

export default function Mesada() {
  const { hoje, sair } = useSessao();
  const c = useCores();

  const [filhos, setFilhos] = useState<Profile[]>([]);
  const [faixas, setFaixas] = useState<AllowanceTier[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Occurrence[]>([]);
  const [fechamentos, setFechamentos] = useState<Record<string, WeeklyClosing[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState<Profile | null>(null);

  const semana = useMemo(() => inicioDaSemana(hoje), [hoje]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [perfis, tiers, occ] = await Promise.all([
        carregarPerfis(),
        carregarFaixas(),
        ocorrenciasDoPeriodo(somarDias(semana, -56), hoje),
      ]);
      const criancas = perfis.filter((p) => p.role === 'child');
      const hist = await Promise.all(criancas.map((p) => carregarFechamentos(p.id)));

      setFilhos(criancas);
      setFaixas(tiers);
      setOcorrencias(occ);
      setFechamentos(Object.fromEntries(criancas.map((p, i) => [p.id, hist[i]])));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [semana, hoje]);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  async function agir(chave: string, acao: () => Promise<unknown>) {
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
        <Titulo>Mesada 💰</Titulo>
        {erro ? <Aviso mensagem={erro} /> : null}

        {filhos.map((filho) => {
          const dela = ocorrencias.filter((o) => o.profile_id === filho.id);
          const resumo = resumoDaSemana(dela, semana);
          const faixa = faixaAlcancada(faixas, resumo.pct);
          const proxima = proximaFaixa(faixas, resumo.pct);
          const faltam = proxima ? tarefasParaAlcancar(resumo, proxima.min_pct) : null;
          const hist = fechamentos[filho.id] ?? [];
          const semanaAtual = hist.find((f) => f.week_start === semana);

          return (
            <View key={filho.id} style={{ gap: esp.md }}>
              <Subtitulo>{filho.display_name.toUpperCase()} — SEMANA ATUAL</Subtitulo>

              <Cartao style={{ gap: esp.md }}>
                <Linha style={{ justifyContent: 'space-between' }}>
                  <Texto style={{ fontSize: 32, fontWeight: '800' }}>{resumo.pct}%</Texto>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Texto style={{ fontSize: 22, fontWeight: '800', color: c.sucesso }}>
                      {formatarReais(faixa?.amount_cents ?? 0)}
                    </Texto>
                    <Texto fraco style={{ fontSize: 12 }}>{faixa?.label ?? 'sem faixa'}</Texto>
                  </View>
                </Linha>

                <Barra fracao={resumo.pct / 100} cor={c.sucesso} altura={14} />

                <Texto fraco style={{ fontSize: 13 }}>
                  {resumo.aprovadas} de {resumo.elegiveis} tarefas que contam
                  {resumo.emAberto > 0 ? ` · ${resumo.emAberto} ainda em aberto` : ''}
                </Texto>

                {/* Mostra o alcançável, não o perdido: é o que mantém a semana viva. */}
                {proxima && faltam !== null && faltam > 0 ? (
                  <Aviso
                    tom="alerta"
                    mensagem={`Faltam ${faltam} ${faltam === 1 ? 'tarefa' : 'tarefas'} para ${formatarReais(proxima.amount_cents)}.`}
                  />
                ) : null}
                {proxima && faltam === null ? (
                  <Texto fraco style={{ fontSize: 13 }}>
                    {formatarReais(proxima.amount_cents)} não é mais alcançável nesta semana.
                  </Texto>
                ) : null}

                {semanaAtual ? (
                  <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
                    <Chip
                      texto={`fechada em ${semanaAtual.pct}% · ${formatarReais(semanaAtual.amount_cents)}`}
                      cor={c.sucesso}
                      fundo={c.sucessoFraco}
                    />
                    {semanaAtual.status === 'paid' ? <Chip texto="paga" /> : null}
                  </Linha>
                ) : null}

                <Linha style={{ gap: esp.sm }}>
                  <Botao
                    titulo={semanaAtual ? 'Recalcular' : 'Fechar a semana'}
                    style={{ flex: 1 }}
                    carregando={ocupado === filho.id}
                    onPress={() => void agir(filho.id, () => fecharSemana(filho.id, semana))}
                  />
                  <Botao
                    titulo="Ajustar pontos"
                    variante="neutro"
                    style={{ flex: 1 }}
                    onPress={() => setAjuste(filho)}
                  />
                </Linha>
              </Cartao>

              {hist.length > 0 ? (
                <View style={{ gap: esp.sm }}>
                  <Subtitulo>SEMANAS FECHADAS</Subtitulo>
                  {hist.map((f) => (
                    <Cartao key={f.id} style={{ gap: esp.sm }}>
                      <Linha style={{ justifyContent: 'space-between' }}>
                        <View style={{ gap: 2 }}>
                          <Texto style={{ fontWeight: '700' }}>
                            semana de {f.week_start.slice(8, 10)}/{f.week_start.slice(5, 7)}
                          </Texto>
                          <Texto fraco style={{ fontSize: 13 }}>
                            {f.approved_count} de {f.eligible_count} · {f.pct}%
                          </Texto>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          <Texto style={{ fontWeight: '800' }}>{formatarReais(f.amount_cents)}</Texto>
                          <Chip
                            texto={f.status === 'paid' ? 'paga' : 'a pagar'}
                            cor={f.status === 'paid' ? c.sucesso : c.alerta}
                            fundo={f.status === 'paid' ? c.sucessoFraco : c.alertaFraco}
                          />
                        </View>
                      </Linha>
                      {f.status !== 'paid' ? (
                        <Botao
                          titulo="Marcar como paga"
                          variante="neutro"
                          carregando={ocupado === f.id}
                          onPress={() =>
                            Alert.alert(
                              'Marcar como paga?',
                              'Depois disso a semana não pode mais ser recalculada.',
                              [
                                { text: 'Cancelar', style: 'cancel' },
                                { text: 'Marcar', onPress: () => void agir(f.id, () => marcarSemanaPaga(f.id)) },
                              ],
                            )
                          }
                        />
                      ) : null}
                    </Cartao>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        <Cartao style={{ gap: esp.xs }}>
          <Subtitulo>AS FAIXAS</Subtitulo>
          {faixas.map((f) => (
            <Linha key={f.id} style={{ justifyContent: 'space-between' }}>
              <Texto fraco>a partir de {f.min_pct}%</Texto>
              <Texto style={{ fontWeight: '700' }}>{formatarReais(f.amount_cents)}</Texto>
            </Linha>
          ))}
          <Texto fraco style={{ fontSize: 12, marginTop: esp.xs }}>
            O piso nunca é zero de propósito: se ela puder zerar, para de tentar no
            meio da semana.
          </Texto>
        </Cartao>

        <Botao titulo="Sair desta conta" variante="neutro" onPress={() => void sair()} />
      </ScrollView>

      <Modal visible={ajuste !== null} animationType="slide" onRequestClose={() => setAjuste(null)}>
        {ajuste ? (
          <FormularioDeAjuste
            filho={ajuste}
            onFechar={() => setAjuste(null)}
            onSalvo={async () => { setAjuste(null); await carregar(); }}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Correção manual. Nunca edita histórico: entra como lançamento novo, com
 * motivo obrigatório — é assim que o extrato continua explicável.
 */
function FormularioDeAjuste({
  filho, onFechar, onSalvo,
}: { filho: Profile; onFechar: () => void; onSalvo: () => Promise<void> }) {
  const c = useCores();
  const [gastavel, setGastavel] = useState('0');
  const [cofrinho, setCofrinho] = useState('0');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function enviar() {
    const g = Number(gastavel) || 0;
    const p = Number(cofrinho) || 0;
    if (g === 0 && p === 0) { Alert.alert('Ajuste vazio', 'Informe algum valor.'); return; }
    if (!motivo.trim()) { Alert.alert('Falta o motivo', 'O extrato precisa dizer por quê.'); return; }
    setSalvando(true);
    try {
      await ajustarPontos(filho.id, g, p, motivo.trim());
      await onSalvo();
    } catch (e) {
      Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }}>
      <ScrollView contentContainerStyle={{ padding: esp.lg, gap: esp.lg }}>
        <Titulo>Ajustar pontos</Titulo>
        <Texto fraco>
          Use valores negativos para descontar. Entra como lançamento novo no extrato
          de {filho.display_name}, sem apagar nada.
        </Texto>

        <CampoTexto rotulo="Saldo gastável (ex: 20 ou -20)" valor={gastavel} onChange={setGastavel} />
        <CampoTexto rotulo="Cofrinho" valor={cofrinho} onChange={setCofrinho} />
        <CampoTexto rotulo="Motivo" valor={motivo} onChange={setMotivo} multilinha placeholder="Ajudou a lavar o carro" />

        <Linha style={{ gap: esp.sm }}>
          <Botao titulo="Cancelar" variante="neutro" style={{ flex: 1 }} onPress={onFechar} />
          <Botao titulo="Lançar" style={{ flex: 1 }} carregando={salvando} onPress={() => void enviar()} />
        </Linha>
      </ScrollView>
    </SafeAreaView>
  );
}
