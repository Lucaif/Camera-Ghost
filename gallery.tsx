import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert, Dimensions, FlatList, Image, Modal,
  Platform, StatusBar, StyleSheet, Text,
  TouchableOpacity, View
} from 'react-native';
import { loadProjects, saveProjects, Project } from './(tabs)/index';

const { width } = Dimensions.get('window');
const COLS = 3;
const THUMB = (width - 4) / COLS;

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    loadProjects().then(projects => {
      const p = projects.find(p => p.id === id);
      if (p) setProject(p);
    });
  }, [id]));

  async function setAsGhost(uri: string) {
    const projects = await loadProjects();
    const updated = projects.map(p => p.id === id ? { ...p, ghostUri: uri } : p);
    await saveProjects(updated);
    setProject(prev => prev ? { ...prev, ghostUri: uri } : prev);
    setSelected(null);
    Alert.alert('✓ Ghost actualizado', 'Esta foto es ahora el ghost del proyecto.');
  }

  async function deletePhoto(uri: string) {
    Alert.alert('Borrar foto', '¿Borrar esta foto del proyecto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive', onPress: async () => {
          const projects = await loadProjects();
          const updated = projects.map(p => {
            if (p.id !== id) return p;
            const photos = p.photos.filter(u => u !== uri);
            const ghostUri = p.ghostUri === uri ? (photos[photos.length - 1] ?? null) : p.ghostUri;
            return { ...p, photos, ghostUri };
          });
          await saveProjects(updated);
          loadProjects().then(ps => {
            const p = ps.find(p => p.id === id);
            if (p) setProject(p);
          });
          setSelected(null);
        }
      }
    ]);
  }

  const photos = project?.photos ?? [];

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.backBtn}>‹ Cámara</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>{project?.name ?? ''}</Text>
          <Text style={s.headerSub}>{photos.length} foto{photos.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {photos.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>📷</Text>
          <Text style={s.emptyText}>Sin fotos todavía</Text>
          <Text style={s.emptySubtext}>Haz fotos desde la cámara</Text>
        </View>
      ) : (
        <FlatList
          data={[...photos].reverse()}
          keyExtractor={(uri, i) => uri + i}
          numColumns={COLS}
          contentContainerStyle={s.grid}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelected(item)}
              activeOpacity={0.85}
              style={s.thumbContainer}
            >
              <Image source={{ uri: item }} style={s.thumb} resizeMode="cover" />
              {project?.ghostUri === item && (
                <View style={s.ghostBadge}>
                  <Text style={s.ghostBadgeText}>GHOST</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Full screen modal */}
      <Modal visible={!!selected} transparent animationType="fade">
        <View style={s.modal}>
          <TouchableOpacity style={s.modalClose} onPress={() => setSelected(null)}>
            <Text style={s.modalCloseText}>✕</Text>
          </TouchableOpacity>

          {selected && (
            <Image source={{ uri: selected }} style={s.modalImg} resizeMode="contain" />
          )}

          <View style={s.modalActions}>
            <TouchableOpacity
              style={s.modalBtn}
              onPress={() => selected && setAsGhost(selected)}
              activeOpacity={0.8}
            >
              <Text style={s.modalBtnText}>👻  Usar como Ghost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, s.modalBtnDanger]}
              onPress={() => selected && deletePhoto(selected)}
              activeOpacity={0.8}
            >
              <Text style={[s.modalBtnText, { color: '#ff6b35' }]}>🗑️  Borrar foto</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { fontSize: 14, color: TEXT, paddingVertical: 4, paddingHorizontal: 8 },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: TEXT },
  headerSub: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: MUTED, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: TEXT },
  emptySubtext: { fontSize: 14, color: MUTED },

  grid: { padding: 2, gap: 0 },
  thumbContainer: { width: THUMB, height: THUMB, padding: 1, position: 'relative' },
  thumb: { width: '100%', height: '100%', backgroundColor: SURFACE },
  ghostBadge: { position: 'absolute', bottom: 5, left: 5, backgroundColor: 'rgba(232,255,71,0.9)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  ghostBadgeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 8, fontWeight: '700', color: '#000', letterSpacing: 1 },

  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.97)', justifyContent: 'center', alignItems: 'center' },
  modalClose: { position: 'absolute', top: 60, right: 20, zIndex: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { fontSize: 20, color: TEXT },
  modalImg: { width: '100%', height: '70%' },
  modalActions: { position: 'absolute', bottom: 50, width: '100%', paddingHorizontal: 24, gap: 12 },
  modalBtn: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  modalBtnDanger: { borderColor: '#ff6b3544' },
  modalBtnText: { fontSize: 15, fontWeight: '600', color: TEXT },
});
