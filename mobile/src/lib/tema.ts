// Paleta única para os dois apps. O dela é mais colorido pelo uso de emoji e
// pelos tamanhos, não por cores diferentes — manter um só tema evita divergência.
import { useColorScheme } from 'react-native';

const claro = {
  fundo: '#F7F7FB',
  cartao: '#FFFFFF',
  cartaoFundo: '#F0F0F6',
  texto: '#15161A',
  textoFraco: '#6B6E7B',
  borda: '#E3E3EC',
  primaria: '#5B4BE8',
  primariaFraca: '#EDEAFD',
  sucesso: '#1E9E62',
  sucessoFraco: '#E4F6ED',
  alerta: '#C8821B',
  alertaFraco: '#FCF2E0',
  erro: '#CE3B4E',
  erroFraco: '#FBE9EB',
  cofrinho: '#1E7FA8',
  cofrinhoFraco: '#E2F2F9',
};

const escuro: typeof claro = {
  fundo: '#0F1013',
  cartao: '#191B21',
  cartaoFundo: '#22242C',
  texto: '#F2F3F7',
  textoFraco: '#9A9EAD',
  borda: '#2B2E38',
  primaria: '#9C8FFF',
  primariaFraca: '#262243',
  sucesso: '#4ECB8E',
  sucessoFraco: '#16301F',
  alerta: '#E8B35C',
  alertaFraco: '#31260F',
  erro: '#F2788A',
  erroFraco: '#331A1F',
  cofrinho: '#63C2E8',
  cofrinhoFraco: '#102A35',
};

export type Cores = typeof claro;

export function useCores(): Cores {
  return useColorScheme() === 'dark' ? escuro : claro;
}

export const esp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const raio = { sm: 8, md: 12, lg: 18, pill: 999 };
