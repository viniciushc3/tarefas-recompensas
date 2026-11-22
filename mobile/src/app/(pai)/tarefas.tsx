import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { carregarTarefas, salvarTarefa } from '@/lib/api';
import { useSessao } from '@/lib/sessao';
import type { DayPeriod, Recurrence, Task, TaskKind } from '@/lib/types';
import { PERIOD_LABEL } from '@/lib/types';
import { esp, raio, useCores } from '@/lib/tema';
import {
  Aviso, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo,
} from '@/componentes/ui';
import { Alternador, CampoTexto, Seletor, SeletorDeDias } from '@/componentes/Campo';

const RECORRENCIA: { valor: Recurrence; texto: string }[] = [
  { valor: 'daily', texto: 'Todo dia' },
  { valor: 'weekdays', texto: 'Dias de semana' },
  { valor: 'weekend', texto: 'Fim de semana' },
  { valor: 'custom', texto: 'Dias certos' },
  { valor: 'once', texto: 'Uma vez' },
];

export default function Tarefas() {
  const { familia } = useSessao();
  const c = useCores();

  const [tarefas, setTarefas] = useState<Task[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Task> | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setTarefas(await carregarTarefas());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  const { basicas, extras, pontosPorDiaUtil } = useMemo(() => {
    const ativas = tarefas.filter((t) => t.active && !t.archived_at);
    const diaUtil = ativas.filter(
      (t) => t.recurrence === 'daily' || t.recurrence === 'weekdays',
    );
    return {
      basicas: ativas.filter((t) => t.kind === 'basic'),
      extras: ativas.filter((t) => t.kind === 'extra'),
      pontosPorDiaUtil: diaUtil.reduce((s, t) => s + t.points, 0),
    };
  }, [tarefas]);

  const taxa = familia?.savings_rate ?? 0.3;
  const gastaveisPorDia = pontosPorDiaUtil - Math.floor(pontosPorDiaUtil * taxa);

  async function salvar(t: Partial<Task>) {
    try {
      await salvarTarefa(t);
      setEditando(null);
      await carregar();
    } catch (e) {
      Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
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
        <Titulo>Tarefas 📋</Titulo>
        {erro ? <Aviso mensagem={erro} /> : null}

        {/* Calibração à vista: o erro clássico é precificar sem saber quanto
            um dia perfeito libera. */}
        <Cartao style={{ gap: esp.xs }}>
          <Subtitulo>CALIBRAÇÃO</Subtitulo>
          <Texto>
            Dia útil completo: <Texto style={{ fontWeight: '800' }}>{pontosPorDiaUtil} pontos</Texto>
          </Texto>
          <Texto fraco style={{ fontSize: 14 }}>
            {gastaveisPorDia} gastáveis + {pontosPorDiaUtil - gastaveisPorDia} no cofrinho.
            {familia ? ` Seu teto é ${familia.daily_screen_cap_minutes} min de tela por dia.` : ''}
          </Texto>
        </Cartao>

        <Botao titulo="+ Nova tarefa" onPress={() => setEditando({ kind: 'extra', recurrence: 'daily' })} />

        <Secao
          titulo="EXTRAS (PAGAM PONTOS)"
          tarefas={extras}
          onEditar={setEditando}
        />
        <Secao
          titulo="BÁSICAS (DEVER — CONTAM PARA A MESADA)"
          tarefas={basicas}
          onEditar={setEditando}
        />

        {tarefas.some((t) => !t.active) ? (
          <Secao
            titulo="DESATIVADAS"
            tarefas={tarefas.filter((t) => !t.active)}
            onEditar={setEditando}
          />
        ) : null}
      </ScrollView>

      <Modal visible={editando !== null} animationType="slide" onRequestClose={() => setEditando(null)}>
        {editando ? (
          <FormularioDeTarefa
            inicial={editando}
            onCancelar={() => setEditando(null)}
            onSalvar={salvar}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function Secao({
  titulo, tarefas, onEditar,
}: { titulo: string; tarefas: Task[]; onEditar: (t: Task) => void }) {
  const c = useCores();
  if (tarefas.length === 0) return null;
  return (
    <View style={{ gap: esp.sm }}>
      <Subtitulo>{titulo}</Subtitulo>
      {tarefas.map((t) => (
        <Cartao key={t.id} onPress={() => onEditar(t)} style={{ gap: esp.sm }}>
          <Linha style={{ gap: esp.md }}>
            <Text style={{ fontSize: 24 }}>{t.icon ?? '⭐'}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <Texto style={{ fontWeight: '700' }}>{t.title}</Texto>
              <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
                {t.points > 0 ? (
                  <Chip texto={`+${t.points}`} cor={c.primaria} fundo={c.primariaFraca} />
                ) : null}
                <Chip texto={PERIOD_LABEL[t.period]} />
                <Chip texto={RECORRENCIA.find((r) => r.valor === t.recurrence)?.texto ?? t.recurrence} />
                {t.requires_approval ? <Chip texto="precisa aprovar" cor={c.alerta} fundo={c.alertaFraco} /> : null}
                {t.requires_photo ? <Chip texto="📷" /> : null}
                {!t.counts_for_allowance ? <Chip texto="fora da mesada" /> : null}
                {!t.active ? <Chip texto="desativada" cor={c.erro} fundo={c.erroFraco} /> : null}
              </Linha>
            </View>
          </Linha>
        </Cartao>
      ))}
    </View>
  );
}

function FormularioDeTarefa({
  inicial, onSalvar, onCancelar,
}: {
  inicial: Partial<Task>;
  onSalvar: (t: Partial<Task>) => Promise<void>;
  onCancelar: () => void;
}) {
  const c = useCores();
  const [t, setT] = useState<Partial<Task>>({
    kind: 'extra', points: 0, period: 'anytime', recurrence: 'daily',
    requires_approval: false, requires_photo: false, counts_for_allowance: true,
    active: true, ...inicial,
  });
  const [salvando, setSalvando] = useState(false);

  function campo<K extends keyof Task>(chave: K, valor: Task[K]) {
    setT((a) => ({ ...a, [chave]: valor }));
  }

  async function enviar() {
    if (!t.title?.trim()) { Alert.alert('Falta o nome', 'Dê um nome para a tarefa.'); return; }
    if (t.recurrence === 'custom' && (t.days_of_week ?? []).length === 0) {
      Alert.alert('Falta escolher os dias', 'Marque pelo menos um dia da semana.');
      return;
    }
    setSalvando(true);
    // O banco exige: foto implica aprovação. Garante aqui para não levar erro.
    const pronto = { ...t, requires_approval: t.requires_photo ? true : t.requires_approval };
    await onSalvar(pronto);
    setSalvando(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }}>
      <ScrollView contentContainerStyle={{ padding: esp.lg, gap: esp.lg, paddingBottom: esp.xxl }}>
        <Titulo>{t.id ? 'Editar tarefa' : 'Nova tarefa'}</Titulo>

        <CampoTexto rotulo="Nome" valor={t.title ?? ''} onChange={(v) => campo('title', v)} placeholder="Tirar o lixo" />
        <CampoTexto rotulo="Emoji" valor={t.icon ?? ''} onChange={(v) => campo('icon', v)} placeholder="🗑️" />

        <Seletor<TaskKind>
          rotulo="Tipo"
          valor={t.kind ?? 'extra'}
          opcoes={[
            { valor: 'extra', texto: 'Extra (paga pontos)' },
            { valor: 'basic', texto: 'Básica (dever)' },
          ]}
          onChange={(v) => setT((a) => ({ ...a, kind: v, points: v === 'basic' ? 0 : a.points }))}
        />

        {t.kind === 'extra' ? (
          <CampoTexto
            rotulo="Pontos"
            numerico
            valor={String(t.points ?? 0)}
            onChange={(v) => campo('points', Number(v.replace(/\D/g, '')) || 0)}
          />
        ) : (
          <Aviso
            tom="alerta"
            mensagem="Tarefa básica não paga pontos, mas conta para o percentual da mesada e para o streak."
          />
        )}

        <Seletor<DayPeriod>
          rotulo="Momento do dia"
          valor={t.period ?? 'anytime'}
          opcoes={[
            { valor: 'morning', texto: 'Manhã' },
            { valor: 'afternoon', texto: 'Tarde' },
            { valor: 'evening', texto: 'Noite' },
            { valor: 'anytime', texto: 'Qualquer hora' },
          ]}
          onChange={(v) => campo('period', v)}
        />

        <Seletor<Recurrence>
          rotulo="Quando repete"
          valor={t.recurrence ?? 'daily'}
          opcoes={RECORRENCIA}
          onChange={(v) => campo('recurrence', v)}
        />

        {t.recurrence === 'custom' ? (
          <SeletorDeDias dias={t.days_of_week ?? []} onChange={(d) => campo('days_of_week', d)} />
        ) : null}

        {t.recurrence === 'once' ? (
          <CampoTexto
            rotulo="Data (AAAA-MM-DD)"
            valor={t.once_on ?? ''}
            onChange={(v) => campo('once_on', v)}
            placeholder="2026-12-24"
          />
        ) : null}

        <Alternador
          rotulo="Precisa da sua aprovação"
          descricao="Deixe desligado no que você vê de qualquer jeito: senão você vira o gargalo."
          valor={t.requires_approval ?? false}
          onChange={(v) => campo('requires_approval', v)}
          desabilitado={t.requires_photo}
        />
        <Alternador
          rotulo="Precisa de foto"
          descricao="Resolve o 'mas eu fiz!' quando você não está em casa. Ativa a aprovação."
          valor={t.requires_photo ?? false}
          onChange={(v) => setT((a) => ({ ...a, requires_photo: v, requires_approval: v || a.requires_approval }))}
        />
        <Alternador
          rotulo="Conta para a mesada"
          descricao="Entra no percentual da semana e no streak."
          valor={t.counts_for_allowance ?? true}
          onChange={(v) => campo('counts_for_allowance', v)}
        />
        <Alternador
          rotulo="Ativa"
          descricao="Desativar para de gerar tarefas novas; o histórico fica."
          valor={t.active ?? true}
          onChange={(v) => campo('active', v)}
        />

        <Linha style={{ gap: esp.sm }}>
          <Botao titulo="Cancelar" variante="neutro" style={{ flex: 1 }} onPress={onCancelar} />
          <Botao titulo="Salvar" style={{ flex: 1 }} carregando={salvando} onPress={() => void enviar()} />
        </Linha>
      </ScrollView>
    </SafeAreaView>
  );
}
