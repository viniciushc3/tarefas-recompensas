import { View } from 'react-native';
import { Barra, Chip, Linha, Texto } from './ui';
import { esp, raio, useCores } from '@/lib/tema';
import { minutosEquivalentes } from '@/lib/datas';

/**
 * Topo da tela dela: os dois saldos e o streak.
 *
 * O saldo gastável aparece traduzido em minutos de tela, porque "91 pontos"
 * não quer dizer nada para ela — "45 min" quer.
 */
export function CabecalhoSaldo({
  gastavel, cofrinho, pontosPorMinuto, streak, metaPontos,
}: {
  gastavel: number;
  cofrinho: number;
  pontosPorMinuto: number;
  streak: number;
  metaPontos?: number | null;
}) {
  const c = useCores();
  const minutos = minutosEquivalentes(gastavel, pontosPorMinuto);

  return (
    <View style={{ gap: esp.md }}>
      <Linha style={{ gap: esp.md }}>
        <View
          style={{
            flex: 1, backgroundColor: c.primariaFraca, borderRadius: raio.lg, padding: esp.lg, gap: 2,
          }}>
          <Texto style={{ fontSize: 12, fontWeight: '800', color: c.primaria, letterSpacing: 0.5 }}>
            PARA GASTAR
          </Texto>
          <Texto style={{ fontSize: 30, fontWeight: '800', color: c.primaria }}>{gastavel}</Texto>
          {pontosPorMinuto > 0 ? (
            <Texto style={{ fontSize: 13, color: c.primaria, opacity: 0.85 }}>
              ≈ {minutos} min de tela
            </Texto>
          ) : null}
        </View>

        <View
          style={{
            flex: 1, backgroundColor: c.cofrinhoFraco, borderRadius: raio.lg, padding: esp.lg, gap: 2,
          }}>
          <Texto style={{ fontSize: 12, fontWeight: '800', color: c.cofrinho, letterSpacing: 0.5 }}>
            COFRINHO
          </Texto>
          <Texto style={{ fontSize: 30, fontWeight: '800', color: c.cofrinho }}>{cofrinho}</Texto>
          {metaPontos ? (
            <View style={{ gap: 4, marginTop: 2 }}>
              <Barra fracao={cofrinho / metaPontos} cor={c.cofrinho} altura={6} />
              <Texto style={{ fontSize: 12, color: c.cofrinho, opacity: 0.85 }}>
                {Math.min(100, Math.round((100 * cofrinho) / metaPontos))}% da meta
              </Texto>
            </View>
          ) : null}
        </View>
      </Linha>

      {streak > 0 ? (
        <Chip
          texto={`🔥 ${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'}`}
          cor={c.alerta}
          fundo={c.alertaFraco}
        />
      ) : null}
    </View>
  );
}
