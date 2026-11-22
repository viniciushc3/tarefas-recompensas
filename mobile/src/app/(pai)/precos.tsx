import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { carregarRecompensas, carregarTarefas, salvarRecompensa } from '@/lib/api';
import { useSessao } from '@/lib/sessao';
import { pontosPorMinutoDeTela } from '@/lib/metricas';
import type { Bucket, Reward, RewardKind, Task } from '@/lib/types';
import { esp, useCores } from '@/lib/tema';
import {
  Aviso, Botao, Carregando, Cartao, Chip, Linha, Subtitulo, Texto, Titulo,
} from '@/componentes/ui';
import { Alternador, CampoTexto, Seletor } from '@/componentes/Campo';

export default function Precos() {
  const { familia } = useSessao();
  const c = useCores();

  const [recompensas, setRecompensas] = useState<Reward[]>([]);
  const [tarefas, setTarefas] = useState<Task[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Reward> | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [rec, tar] = await Promise.all([carregarRecompensas(true), carregarTarefas()]);
      setRecompensas(rec);
      setTarefas(tar);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void carregar(); }, [carregar]));

  /**
   * O cálculo que evita o erro clássico: precificar primeiro e descobrir depois
   * que ela desbloqueou quatro horas de tela por dia.
   */
  const calibragem = useMemo(() => {
    const taxa = familia?.savings_rate ?? 0.3;
    const diaUtil = tarefas
      .filter((t) => t.active && !t.archived_at && (t.recurrence === 'daily' || t.recurrence === 'weekdays'))
      .reduce((s, t) => s + t.points, 0);
    const gastaveis = diaUtil - Math.floor(diaUtil * taxa);
    const porMinuto = pontosPorMinutoDeTela(recompensas.filter((r) => r.active));
    const minutos = porMinuto > 0 ? Math.floor(gastaveis / porMinuto) : 0;
    const teto = familia?.daily_screen_cap_minutes ?? 40;
    return { gastaveis, minutos, teto, acimaDoTeto: minutos > teto };
  }, [tarefas, recompensas, familia]);

  async function salvar(r: Partial<Reward>) {
    try {
      await salvarRecompensa(r);
      setEditando(null);
      await carregar();
    } catch (e) {
      Alert.alert('Não deu', e instanceof Error ? e.message : String(e));
    }
  }

  if (carregando) return <Carregando />;

  const porTipo = (k: RewardKind) => recompensas.filter((r) => r.kind === k);

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
        <Titulo>Preços 🏷️</Titulo>
        {erro ? <Aviso mensagem={erro} /> : null}

        <Cartao style={{ gap: esp.sm }}>
          <Subtitulo>NUM DIA ÚTIL PERFEITO</Subtitulo>
          <Texto>
            Ela ganha <Texto style={{ fontWeight: '800' }}>{calibragem.gastaveis} pontos gastáveis</Texto>
            {calibragem.minutos > 0 ? (
              <> ≈ <Texto style={{ fontWeight: '800' }}>{calibragem.minutos} min de tela</Texto></>
            ) : null}
          </Texto>
          {calibragem.acimaDoTeto ? (
            <Aviso
              tom="alerta"
              mensagem={`Acima do seu teto de ${calibragem.teto} min. Aumente o preço da tela ou baixe os pontos das tarefas.`}
            />
          ) : (
            <Texto fraco style={{ fontSize: 13 }}>
              Dentro do teto de {calibragem.teto} min. Precifique sempre de trás pra frente:
              decida o máximo aceitável e derive os preços disso.
            </Texto>
          )}
        </Cartao>

        <Botao
          titulo="+ Nova recompensa"
          onPress={() => setEditando({ kind: 'privilege', bucket: 'spendable', active: true })}
        />

        <Grupo titulo="TEMPO DE TELA" itens={porTipo('screen_time')} onEditar={setEditando} />
        <Grupo titulo="PRIVILÉGIOS" itens={porTipo('privilege')} onEditar={setEditando} />
        <Grupo titulo="META GRANDE (SÓ DO COFRINHO)" itens={porTipo('big_prize')} onEditar={setEditando} />
      </ScrollView>

      <Modal visible={editando !== null} animationType="slide" onRequestClose={() => setEditando(null)}>
        {editando ? (
          <FormularioDeRecompensa
            inicial={editando}
            onCancelar={() => setEditando(null)}
            onSalvar={salvar}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function Grupo({
  titulo, itens, onEditar,
}: { titulo: string; itens: Reward[]; onEditar: (r: Reward) => void }) {
  const c = useCores();
  if (itens.length === 0) return null;
  return (
    <View style={{ gap: esp.sm }}>
      <Subtitulo>{titulo}</Subtitulo>
      {itens.map((r) => (
        <Cartao key={r.id} onPress={() => onEditar(r)}>
          <Linha style={{ gap: esp.md }}>
            <Text style={{ fontSize: 24 }}>{r.icon ?? '🎁'}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <Texto style={{ fontWeight: '700' }}>{r.title}</Texto>
              <Linha style={{ gap: esp.sm, flexWrap: 'wrap' }}>
                <Chip texto={`${r.cost_points} pts`} cor={c.primaria} fundo={c.primariaFraca} />
                {r.screen_minutes ? <Chip texto={`${r.screen_minutes} min`} /> : null}
                {r.bucket === 'savings' ? <Chip texto="cofrinho" cor={c.cofrinho} fundo={c.cofrinhoFraco} /> : null}
                {!r.active ? <Chip texto="desativada" cor={c.erro} fundo={c.erroFraco} /> : null}
              </Linha>
            </View>
          </Linha>
        </Cartao>
      ))}
    </View>
  );
}

function FormularioDeRecompensa({
  inicial, onSalvar, onCancelar,
}: {
  inicial: Partial<Reward>;
  onSalvar: (r: Partial<Reward>) => Promise<void>;
  onCancelar: () => void;
}) {
  const c = useCores();
  const [r, setR] = useState<Partial<Reward>>({
    kind: 'privilege', bucket: 'spendable', cost_points: 50, active: true, ...inicial,
  });
  const [salvando, setSalvando] = useState(false);

  function campo<K extends keyof Reward>(chave: K, valor: Reward[K]) {
    setR((a) => ({ ...a, [chave]: valor }));
  }

  async function enviar() {
    if (!r.title?.trim()) { Alert.alert('Falta o nome', 'Dê um nome para a recompensa.'); return; }
    if (!r.cost_points || r.cost_points <= 0) { Alert.alert('Preço inválido', 'O custo precisa ser maior que zero.'); return; }
    if (r.kind === 'screen_time' && !r.screen_minutes) {
      Alert.alert('Faltam os minutos', 'Diga quantos minutos de tela essa recompensa vale.');
      return;
    }
    setSalvando(true);
    // Regras do banco: meta grande sai do cofrinho; o resto, do saldo gastável.
    const pronto: Partial<Reward> = {
      ...r,
      bucket: r.kind === 'big_prize' ? 'savings' : r.bucket,
      screen_minutes: r.kind === 'screen_time' ? r.screen_minutes : null,
    };
    await onSalvar(pronto);
    setSalvando(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.fundo }}>
      <ScrollView contentContainerStyle={{ padding: esp.lg, gap: esp.lg, paddingBottom: esp.xxl }}>
        <Titulo>{r.id ? 'Editar recompensa' : 'Nova recompensa'}</Titulo>

        <CampoTexto rotulo="Nome" valor={r.title ?? ''} onChange={(v) => campo('title', v)} placeholder="30 min de tela" />
        <CampoTexto rotulo="Emoji" valor={r.icon ?? ''} onChange={(v) => campo('icon', v)} placeholder="📱" />

        <Seletor<RewardKind>
          rotulo="Tipo"
          valor={r.kind ?? 'privilege'}
          opcoes={[
            { valor: 'screen_time', texto: 'Tempo de tela' },
            { valor: 'privilege', texto: 'Privilégio' },
            { valor: 'big_prize', texto: 'Meta grande' },
          ]}
          onChange={(v) =>
            setR((a) => ({ ...a, kind: v, bucket: v === 'big_prize' ? 'savings' : 'spendable' }))
          }
        />

        <CampoTexto
          rotulo="Custo em pontos"
          numerico
          valor={String(r.cost_points ?? 0)}
          onChange={(v) => campo('cost_points', Number(v.replace(/\D/g, '')) || 0)}
        />

        {r.kind === 'screen_time' ? (
          <CampoTexto
            rotulo="Minutos de tela"
            numerico
            valor={String(r.screen_minutes ?? '')}
            onChange={(v) => campo('screen_minutes', Number(v.replace(/\D/g, '')) || null)}
          />
        ) : null}

        {r.kind === 'big_prize' ? (
          <Aviso
            tom="alerta"
            mensagem="Meta grande sai só do cofrinho. É isso que impede ela de gastar a poupança em tela."
          />
        ) : (
          <Seletor<Bucket>
            rotulo="Sai de qual saldo"
            valor={r.bucket ?? 'spendable'}
            opcoes={[
              { valor: 'spendable', texto: 'Gastável' },
              { valor: 'savings', texto: 'Cofrinho' },
            ]}
            onChange={(v) => campo('bucket', v)}
          />
        )}

        <Alternador
          rotulo="Ativa"
          descricao="Desativada não aparece na loja dela."
          valor={r.active ?? true}
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
