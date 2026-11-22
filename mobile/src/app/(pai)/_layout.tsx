import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useCores } from '@/lib/tema';

function Icone({ emoji, foco }: { emoji: string; foco: boolean }) {
  return <Text style={{ fontSize: foco ? 24 : 20, opacity: foco ? 1 : 0.55 }}>{emoji}</Text>;
}

export default function LayoutPai() {
  const c = useCores();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primaria,
        tabBarInactiveTintColor: c.textoFraco,
        tabBarStyle: { backgroundColor: c.cartao, borderTopColor: c.borda },
        tabBarLabelStyle: { fontWeight: '700' },
      }}>
      <Tabs.Screen
        name="fila"
        options={{ title: 'Fila', tabBarIcon: ({ focused }) => <Icone emoji="📥" foco={focused} /> }}
      />
      <Tabs.Screen
        name="tarefas"
        options={{ title: 'Tarefas', tabBarIcon: ({ focused }) => <Icone emoji="📋" foco={focused} /> }}
      />
      <Tabs.Screen
        name="precos"
        options={{ title: 'Preços', tabBarIcon: ({ focused }) => <Icone emoji="🏷️" foco={focused} /> }}
      />
      <Tabs.Screen
        name="mesada"
        options={{ title: 'Mesada', tabBarIcon: ({ focused }) => <Icone emoji="💰" foco={focused} /> }}
      />
    </Tabs>
  );
}
