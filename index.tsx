import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert, FlatList, Image, Platform,
  StatusBar, StyleSheet, Text,
  TouchableOpacity, View
} from 'react-native';

export type Tilt = {
  x: number;
  y: number;
  z: number;
};

export type Project = {
  id: string;
  name: string;
  ghostUri: string | null;
  ghostTilt: Tilt | null;
  photos: string[];
  createdAt: number;
};

const STORAGE_KEY = 'ghost_projects';

export async function loadProjects(): Promise<Project[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveProjects(projects: Project[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const router = useRouter();

  useFocusEffect(useCallback(() => {
    loadProjects().then(setProjects);
  }, []));

  function createProject() {
    Alert.prompt(
      'Nuevo proyecto',
      'Nombre del proyecto:',
      (name) => {
        if (!name?.trim()) return;
        const newProject: Project = {
          id: Date.now().toString(),
          name: name.trim(),
          ghostUri: null,
          ghostTilt: null,
          photos: [],
          createdAt: Date.now(),
        };
        const updated = [...projects, newProject];
        setProjects(updated);
        saveProjects(updated);
      },
      'plain-text',
      '',
    );
  }

  function deleteProject(id: string) {
    Alert.alert('Borrar proyecto', '¿Seguro que quieres borrar este proyecto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive', onPress: () => {
          const updated = projects.filter(p => p.id !== id);
          setProjects(updated);
          saveProjects(updated);
        }
      }
    ]);
  }

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      <View style={s.header}>
        <Text style={s.headerTag}>GHOST CAMERA</Text>
        <Text style={s.headerTitle}>Proyectos</Text>
      </View>

      {projects.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>👻</Text>
          <Text style={s.emptyText}>Sin proyectos todavía</Text>
          <Text style={s.emptySubtext}>Crea uno para empezar</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={p => p.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              onPress={() => router.push({ pathname: '/camera', params: { id: item.id } })}
              onLongPress={() => deleteProject(item.id)}
              activeOpacity={0.8}
            >
              <View style={s.cardThumb}>
                {item.ghostUri ? (
                  <Image source={{ uri: item.ghostUri }} style={s.cardThumbImg} resizeMode="cover" />
                ) : (
                  <Text style={{ fontSize: 24 }}>👻</Text>
                )}
              </View>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{item.name}</Text>
                <Text style={s.cardSub}>
                  {item.ghostUri ? '● Ghost guardado' : '○ Sin ghost'}
                  {item.photos?.length ? `  ·  ${item.photos.length} foto${item.photos.length > 1 ? 's' : ''}` : ''}
                  {item.ghostTilt ? '  ·  📐' : ''}
                </Text>
              </View>
              <Text style={s.cardArrow}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={s.newBtn} onPress={createProject} activeOpacity={0.85}>
        <Text style={s.newBtnText}>+ Nuevo proyecto</Text>
      </TouchableOpacity>
      <Text style={s.hint}>Mantén pulsado un proyecto para borrarlo</Text>
    </View>
  );
}

const ACCENT = '#e8ff47';
const BG = '#0a0a0a';
const SURFACE = '#111';
const BORDER = '#222';
const MUTED = '#555';
const TEXT = '#f0f0f0';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingTop: 70, paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTag: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 3, color: ACCENT, marginBottom: 6 },
  headerTitle: { fontSize: 32, fontWeight: '700', color: TEXT },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: TEXT },
  emptySubtext: { fontSize: 14, color: MUTED },
  list: { padding: 16, gap: 12 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 12, gap: 14 },
  cardThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardThumbImg: { width: '100%', height: '100%' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '600', color: TEXT, marginBottom: 4 },
  cardSub: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: MUTED, letterSpacing: 1 },
  cardArrow: { fontSize: 24, color: MUTED },
  newBtn: { margin: 16, marginBottom: 8, paddingVertical: 18, backgroundColor: ACCENT, borderRadius: 14, alignItems: 'center' },
  newBtnText: { fontSize: 16, fontWeight: '700', color: '#000' },
  hint: { textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: MUTED, marginBottom: 32 },
});
