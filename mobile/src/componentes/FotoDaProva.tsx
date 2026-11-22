import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { urlDaFoto } from '@/lib/api';
import { raio, useCores } from '@/lib/tema';
import { Texto } from './ui';

/** A foto fica num bucket privado: precisa de URL assinada, que expira. */
export function FotoDaProva({ caminho, altura = 220 }: { caminho: string; altura?: number }) {
  const c = useCores();
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    urlDaFoto(caminho)
      .then((u) => { if (vivo) u ? setUrl(u) : setFalhou(true); })
      .catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [caminho]);

  if (falhou) return <Texto fraco style={{ fontSize: 13 }}>Não foi possível carregar a foto.</Texto>;
  if (!url) return null;

  return (
    <Image
      source={{ uri: url }}
      style={{ width: '100%', height: altura, borderRadius: raio.md, backgroundColor: c.cartaoFundo }}
      resizeMode="cover"
    />
  );
}
