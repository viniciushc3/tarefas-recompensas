import React from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { esp, raio, useCores } from '@/lib/tema';
import { Linha, Subtitulo, Texto } from './ui';

export function CampoTexto({
  rotulo, valor, onChange, placeholder, numerico, multilinha,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numerico?: boolean;
  multilinha?: boolean;
}) {
  const c = useCores();
  return (
    <View style={{ gap: esp.xs }}>
      <Subtitulo>{rotulo.toUpperCase()}</Subtitulo>
      <TextInput
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textoFraco}
        keyboardType={numerico ? 'number-pad' : 'default'}
        multiline={multilinha}
        style={{
          backgroundColor: c.cartaoFundo,
          borderRadius: raio.md,
          padding: esp.md,
          fontSize: 16,
          color: c.texto,
          minHeight: multilinha ? 72 : undefined,
        }}
      />
    </View>
  );
}

export function Seletor<T extends string>({
  rotulo, valor, opcoes, onChange,
}: {
  rotulo: string;
  valor: T;
  opcoes: { valor: T; texto: string }[];
  onChange: (v: T) => void;
}) {
  const c = useCores();
  return (
    <View style={{ gap: esp.xs }}>
      <Subtitulo>{rotulo.toUpperCase()}</Subtitulo>
      <Linha style={{ flexWrap: 'wrap', gap: esp.sm }}>
        {opcoes.map((o) => {
          const ativo = o.valor === valor;
          return (
            <Pressable
              key={o.valor}
              onPress={() => onChange(o.valor)}
              style={{
                paddingVertical: esp.sm,
                paddingHorizontal: esp.md,
                borderRadius: raio.pill,
                backgroundColor: ativo ? c.primaria : c.cartaoFundo,
              }}>
              <Texto style={{ color: ativo ? '#FFF' : c.texto, fontWeight: '700', fontSize: 14 }}>
                {o.texto}
              </Texto>
            </Pressable>
          );
        })}
      </Linha>
    </View>
  );
}

export function Alternador({
  rotulo, descricao, valor, onChange, desabilitado,
}: {
  rotulo: string;
  descricao?: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  desabilitado?: boolean;
}) {
  const c = useCores();
  return (
    <Linha style={{ justifyContent: 'space-between', gap: esp.md, opacity: desabilitado ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Texto style={{ fontWeight: '600' }}>{rotulo}</Texto>
        {descricao ? <Texto fraco style={{ fontSize: 13 }}>{descricao}</Texto> : null}
      </View>
      <Switch
        value={valor}
        onValueChange={onChange}
        disabled={desabilitado}
        trackColor={{ true: c.primaria, false: c.borda }}
      />
    </Linha>
  );
}

/** Dias da semana para recorrência personalizada. 0=domingo, como no Postgres. */
export function SeletorDeDias({
  dias, onChange,
}: { dias: number[]; onChange: (d: number[]) => void }) {
  const c = useCores();
  const nomes = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  return (
    <View style={{ gap: esp.xs }}>
      <Subtitulo>DIAS</Subtitulo>
      <Linha style={{ gap: esp.sm }}>
        {nomes.map((n, i) => {
          const ativo = dias.includes(i);
          return (
            <Pressable
              key={i}
              onPress={() => onChange(ativo ? dias.filter((d) => d !== i) : [...dias, i].sort())}
              style={{
                width: 38, height: 38, borderRadius: 19,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: ativo ? c.primaria : c.cartaoFundo,
              }}>
              <Texto style={{ color: ativo ? '#FFF' : c.textoFraco, fontWeight: '800' }}>{n}</Texto>
            </Pressable>
          );
        })}
      </Linha>
    </View>
  );
}
