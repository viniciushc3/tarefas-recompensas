import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useCores } from '@/lib/tema';

function Icone({ emoji, foco }: { emoji: string; foco: boolean }) {
  return <Text style={{ fontSize: foco ? 26 : 22, opacity: foco ? 1 : 0.55 }}>{emoji}</Text>;
}

export default function LayoutFilha() {
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
        name="hoje"
        options={{ title: 'Hoje', tabBarIcon: ({ focused }) => <Icone emoji="✅" foco={focused} /> }}
      />
      <Tabs.Screen
        name="loja"
        options={{ title: 'Loja', tabBarIcon: ({ focused }) => <Icone emoji="🎁" foco={focused} /> }}
      />
      <Tabs.Screen
        name="meta"
        options={{ title: 'Meta', tabBarIcon: ({ focused }) => <Icone emoji="🎯" foco={focused} /> }}
      />
      <Tabs.Screen
        name="extrato"
        options={{ title: 'Extrato', tabBarIcon: ({ focused }) => <Icone emoji="🧾" foco={focused} /> }}
      />
    </Tabs>
  );
}
