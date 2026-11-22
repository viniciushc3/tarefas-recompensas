import React from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle,
} from 'react-native';
import { esp, raio, useCores, type Cores } from '@/lib/tema';

export function Titulo({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const c = useCores();
  return <Text style={[{ fontSize: 28, fontWeight: '800', color: c.texto }, style]}>{children}</Text>;
}

export function Subtitulo({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const c = useCores();
  return (
    <Text style={[{ fontSize: 13, fontWeight: '700', color: c.textoFraco, letterSpacing: 0.6 }, style]}>
      {children}
    </Text>
  );
}

export function Texto({
  children, fraco, style, numberOfLines,
}: {
  children: React.ReactNode; fraco?: boolean; style?: TextStyle; numberOfLines?: number;
}) {
  const c = useCores();
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontSize: 16, color: fraco ? c.textoFraco : c.texto }, style]}>
      {children}
    </Text>
  );
}

export function Cartao({
  children, style, onPress,
}: {
  children: React.ReactNode; style?: ViewStyle; onPress?: () => void;
}) {
  const c = useCores();
  const base: ViewStyle = {
    backgroundColor: c.cartao,
    borderRadius: raio.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borda,
    padding: esp.lg,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { opacity: 0.7, transform: [{ scale: 0.99 }] }, style]}>
      {children}
    </Pressable>
  );
}

type VarianteBotao = 'primario' | 'sucesso' | 'erro' | 'neutro';

export function Botao({
  titulo, onPress, variante = 'primario', desabilitado, carregando, style, grande,
}: {
  titulo: string;
  onPress: () => void;
  variante?: VarianteBotao;
  desabilitado?: boolean;
  carregando?: boolean;
  style?: ViewStyle;
  grande?: boolean;
}) {
  const c = useCores();
  const fundo: Record<VarianteBotao, string> = {
    primario: c.primaria, sucesso: c.sucesso, erro: c.erro, neutro: c.cartaoFundo,
  };
  const cor = variante === 'neutro' ? c.texto : '#FFFFFF';
  const inativo = desabilitado || carregando;

  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      style={({ pressed }) => [
        {
          backgroundColor: fundo[variante],
          borderRadius: raio.md,
          paddingVertical: grande ? esp.lg : esp.md,
          paddingHorizontal: esp.lg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inativo ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {carregando ? (
        <ActivityIndicator color={cor} />
      ) : (
        <Text style={{ color: cor, fontWeight: '700', fontSize: grande ? 18 : 16 }}>{titulo}</Text>
      )}
    </Pressable>
  );
}

export function Chip({
  texto, cor, fundo,
}: { texto: string; cor?: string; fundo?: string }) {
  const c = useCores();
  return (
    <View
      style={{
        backgroundColor: fundo ?? c.cartaoFundo,
        paddingHorizontal: esp.sm + 2,
        paddingVertical: 3,
        borderRadius: raio.pill,
        alignSelf: 'flex-start',
      }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: cor ?? c.textoFraco }}>{texto}</Text>
    </View>
  );
}

/** Barra de progresso. Usada na meta grande e no percentual da semana. */
export function Barra({
  fracao, cor, altura = 12,
}: { fracao: number; cor?: string; altura?: number }) {
  const c = useCores();
  const f = Math.max(0, Math.min(1, Number.isFinite(fracao) ? fracao : 0));
  return (
    <View style={{ height: altura, backgroundColor: c.cartaoFundo, borderRadius: raio.pill, overflow: 'hidden' }}>
      <View style={{ width: `${f * 100}%`, height: '100%', backgroundColor: cor ?? c.primaria, borderRadius: raio.pill }} />
    </View>
  );
}

export function Carregando({ texto }: { texto?: string }) {
  const c = useCores();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: esp.md, backgroundColor: c.fundo }}>
      <ActivityIndicator color={c.primaria} size="large" />
      {texto ? <Texto fraco>{texto}</Texto> : null}
    </View>
  );
}

export function Vazio({ emoji, titulo, descricao }: { emoji: string; titulo: string; descricao?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: esp.xxl * 1.5, gap: esp.sm }}>
      <Text style={{ fontSize: 48 }}>{emoji}</Text>
      <Texto style={{ fontWeight: '700', fontSize: 18 }}>{titulo}</Texto>
      {descricao ? (
        <Texto fraco style={{ textAlign: 'center', paddingHorizontal: esp.xl }}>{descricao}</Texto>
      ) : null}
    </View>
  );
}

export function Aviso({ mensagem, tom = 'erro' }: { mensagem: string; tom?: 'erro' | 'alerta' }) {
  const c = useCores();
  const fundo = tom === 'erro' ? c.erroFraco : c.alertaFraco;
  const cor = tom === 'erro' ? c.erro : c.alerta;
  return (
    <View style={{ backgroundColor: fundo, borderRadius: raio.md, padding: esp.md }}>
      <Text style={{ color: cor, fontWeight: '600' }}>{mensagem}</Text>
    </View>
  );
}

export function Linha({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: esp.sm }, style]}>{children}</View>;
}

export function corDoSaldo(c: Cores, bucket: 'spendable' | 'savings') {
  return bucket === 'savings'
    ? { cor: c.cofrinho, fundo: c.cofrinhoFraco }
    : { cor: c.primaria, fundo: c.primariaFraca };
}
