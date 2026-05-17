import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Image, Platform, ScrollView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import Slider from '@react-native-community/slider';
import { loadProjects, saveProjects, Project, Tilt } from './(tabs)/index';

const THRESHOLD = 0.04;
const GHOST_MODE_KEY = 'ghost_mode';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function AxisBar({ label, diff, arrow }: { label: string; diff: number; arrow: string }) {
  const abs = Math.abs(diff);
  const aligned = abs < THRESHOLD;
  const r = aligned ? 100 : Math.round(232 * clamp(abs / 0.3, 0, 1) + 80 * (1 - clamp(abs / 0.3, 0, 1)));
  const g = aligned ? 220 : Math.round(80 * (1 - clamp(abs / 0.3, 0, 1)));
  const b = aligned ? 71 : 0;
  const color = `rgb(${r},${g},${b})`;
  const degrees = Math.round(Math.asin(clamp(abs, -1, 1)) * (180 / Math.PI));
  return (
    <View style={ab.row}>
      <View style={ab.labelBox}>
        <Text style={[ab.label, { color }]}>{label}</Text>
        <Text style={[ab.arrow, { color }]}>{aligned ? '●' : arrow}</Text>
      </View>
      <View style={ab.barTrack}>
        <View style={[ab.barFill, { width: `${aligned ? 100 : clamp(degrees / 45 * 100, 0, 100)}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[ab.deg, { color }]}>{aligned ? '0°' : `${degrees}°`}</Text>
    </View>
  );
}

function TiltGuide({ current, target, aligned }: { current: Tilt; target: Tilt; aligned: boolean }) {
  const dx = target.z - current.z;
  const dz = target.x - current.x;
  const tiltArrow = dx > 0 ? '↑' : '↓';
  const rotArrow = dz > 0 ? '↻' : '↺';
  return (
    <View style={[tg.panel, aligned && tg.panelAligned]}>
      <AxisBar label="TILT" diff={dx} arrow={tiltArrow} />
      <View style={tg.divider} />
      <AxisBar label="ROT" diff={dz} arrow={rotArrow} />
    </View>
  );
}

export default function CameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [project, setProject] = useState<Project | null>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [ghostOn, setGhostOn] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [flash, setFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [tilt, setTilt] = useState<Tilt>({ x: 0, y: 0, z: 0 });
  const [showTilt, setShowTilt] = useState(true);
  const [ghostMode, setGhostModeState] = useState<'first' | 'previous'>('first');
  const cameraRef = useRef<CameraView>(null);
  const projectsCache = useRef<Project[] | null>(null);
  const albumIdCache = useRef<string | null>(null);

  // Cargar ghostMode persistido
  useEffect(() => {
    AsyncStorage.getItem(GHOST_MODE_KEY).then(val => {
      if (val === 'first' || val === 'previous') setGhostModeState(val);
    });
  }, []);

  // Acelerómetro pausado cuando galería está abierta
  useEffect(() => {
    if (showGallery) return;
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener(({ x, y, z }) => setTilt({ x, y, z }));
    return () => sub.remove();
  }, [showGallery]);

  useEffect(() => {
    loadProjects().then(projects => {
      projectsCache.current = projects;
      const p = projects.find(p => p.id === id);
      if (p) { setProject(p); if (p.ghostUri) setGhostOn(true); }
    });
  }, [id]);

  async function updateProject(updates: Partial<Project>) {
    const projects = projectsCache.current ?? await loadProjects();
    const updated = projects.map(p => p.id === id ? { ...p, ...updates } : p);
    projectsCache.current = updated;
    await saveProjects(updated);
    setProject(prev => prev ? { ...prev, ...updates } : prev);
  }

  // Cambiar modo Y actualizar ghost inmediatamente
  function setGhostMode(mode: 'first' | 'previous') {
    setGhostModeState(mode);
    AsyncStorage.setItem(GHOST_MODE_KEY, mode);

    const photos = project?.photos ?? [];
    if (photos.length === 0) return;

    if (mode === 'first') {
      updateProject({ ghostUri: photos[0], ghostTilt: project?.ghostTilt });
    } else {
      const last = photos[photos.length - 1];
      updateProject({ ghostUri: last, ghostTilt: project?.ghostTilt });
    }
    setGhostOn(true);
  }

  async function saveToAlbum(uri: string) {
    try {
      if (!mediaPermission?.granted) {
        const { granted } = await requestMediaPermission();
        if (!granted) { Alert.alert('Sin permiso', 'Activa el acceso a fotos en Configuración.'); return; }
      }
      const asset = await MediaLibrary.createAssetAsync(uri);
      if (albumIdCache.current) {
        const album = await MediaLibrary.getAlbumAsync(albumIdCache.current);
        if (album) { await MediaLibrary.addAssetsToAlbumAsync([asset], album, false); return; }
      }
      const albums = await MediaLibrary.getAlbumsAsync();
      const existing = albums.find(a => a.title === 'Ghost Camera');
      if (existing) {
        albumIdCache.current = existing.id;
        await MediaLibrary.addAssetsToAlbumAsync([asset], existing, false);
      } else {
        const newAlbum = await MediaLibrary.createAlbumAsync('Ghost Camera', asset, false);
        albumIdCache.current = newAlbum.id;
      }
    } catch (e) { console.warn('Error guardando foto:', e); }
  }

  async function capturePhoto() {
    if (!cameraRef.current || saving) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    try {
      setSaving(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: true });
      if (photo?.uri) {
        const currentPhotos = project?.photos ?? [];
        const isFirstPhoto = currentPhotos.length === 0;
        const newGhostUri = ghostMode === 'first'
          ? (isFirstPhoto ? photo.uri : project?.ghostUri ?? photo.uri)
          : photo.uri;
        const newGhostTilt = ghostMode === 'first'
          ? (isFirstPhoto ? { ...tilt } : project?.ghostTilt ?? { ...tilt })
          : { ...tilt };
        await updateProject({ ghostUri: newGhostUri, ghostTilt: newGhostTilt, photos: [...currentPhotos, photo.uri] });
        setGhostOn(true);
        await saveToAlbum(photo.uri);
      }
    } catch (e) { console.warn('Error al capturar:', e); }
    finally { setSaving(false); }
  }

  function setAsGhost(uri: string) {
    updateProject({ ghostUri: uri, ghostTilt: { ...tilt } });
    setGhostOn(true);
    setShowGallery(false);
  }

  function deletePhoto(uri: string) {
    Alert.alert('Borrar foto', '¿Borrar esta foto del proyecto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive', onPress: async () => {
          const newPhotos = (project?.photos ?? []).filter(p => p !== uri);
          const newGhost = project?.ghostUri === uri ? (newPhotos[newPhotos.length - 1] ?? null) : project?.ghostUri;
          await updateProject({ photos: newPhotos, ghostUri: newGhost, ghostTilt: newGhost ? project?.ghostTilt : null });
          if (!newGhost) setGhostOn(false);
        }
      }
    ]);
  }

  if (!permission) return <View style={s.container} />;

  if (!permission.granted) {
    return (
      <View style={s.permScreen}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontSize: 36, marginBottom: 24 }}>📷</Text>
        <Text style={s.permHeading}>Acceso a la cámara</Text>
        <Text style={s.permDesc}>Ghost Camera necesita acceder a tu cámara.</Text>
        <TouchableOpacity style={s.grantBtn} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={s.grantBtnText}>Permitir acceso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ghostUri = project?.ghostUri ?? null;
  const ghostTilt = project?.ghostTilt ?? null;
  const photos = project?.photos ?? [];
  const isAligned = ghostTilt
    ? Math.abs(ghostTilt.z - tilt.z) < THRESHOLD && Math.abs(ghostTilt.x - tilt.x) < THRESHOLD
    : false;

  // ── Gallery ────────────────────────────────────────────
  if (showGallery) {
    return (
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <View style={s.galleryHeader}>
          <TouchableOpacity onPress={() => setShowGallery(false)} activeOpacity={0.7}>
            <Text style={s.galleryBack}>‹ Cámara</Text>
          </TouchableOpacity>
          <Text style={s.galleryTitle}>{project?.name}</Text>
          <TouchableOpacity
            onPress={() => { setShowGallery(false); router.push({ pathname: '/timelapse', params: { id } }); }}
            activeOpacity={0.8}
            style={s.timelapseBtn}
          >
            <Text style={s.timelapseBtnText}>🎬 Timelapse</Text>
          </TouchableOpacity>
        </View>
        {photos.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📷</Text>
            <Text style={s.emptyText}>Sin fotos todavía</Text>
            <Text style={s.emptySubtext}>Captura una foto para empezar</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }}>
            <View style={s.grid}>
              {photos.map((uri, i) => (
                <TouchableOpacity
                  key={i}
                  style={[s.gridItem, ghostUri === uri && s.gridItemActive]}
                  onPress={() => setAsGhost(uri)}
                  onLongPress={() => deletePhoto(uri)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri }} style={s.gridImg} resizeMode="cover" />
                  {ghostUri === uri && (
                    <View style={s.ghostBadge}><Text style={s.ghostBadgeText}>GHOST</Text></View>
                  )}
                  <View style={s.photoNumber}><Text style={s.photoNumberText}>{i + 1}</Text></View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
        <Text style={s.hint}>Toca para usar como ghost · Mantén para borrar</Text>
      </View>
    );
  }

  // ── Camera ─────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <View style={s.viewfinder}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
        {ghostUri && ghostOn && (
          <Image source={{ uri: ghostUri }} style={[StyleSheet.absoluteFill, { opacity }]} resizeMode="cover" />
        )}
        {flash && <View style={s.flash} />}
        <View style={[s.corner, s.tl, isAligned && s.cornerAligned]} />
        <View style={[s.corner, s.tr, isAligned && s.cornerAligned]} />
        <View style={[s.corner, s.bl, isAligned && s.cornerAligned]} />
        <View style={[s.corner, s.br, isAligned && s.cornerAligned]} />
        <View style={s.crosshairH} />
        <View style={s.crosshairV} />
        {ghostTilt && showTilt && (
          <View style={s.tiltContainer}>
            <TiltGuide current={tilt} target={ghostTilt} aligned={isAligned} />
          </View>
        )}
        <View style={s.projectBadge}>
          <Text style={s.projectBadgeText}>{project?.name ?? ''}</Text>
        </View>
        {ghostOn && (
          <View style={s.ghostLabel}><Text style={s.ghostLabelText}>GHOST ON</Text></View>
        )}
        {saving && (
          <View style={s.savingBadge}><Text style={s.savingText}>GUARDANDO...</Text></View>
        )}
        <TouchableOpacity style={s.backBtn} onPress={() => router.replace('/')} activeOpacity={0.7}>
          <Text style={s.backBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={s.topRight}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} activeOpacity={0.7}>
            <Text style={{ fontSize: 18 }}>🔄</Text>
          </TouchableOpacity>
          {ghostTilt && (
            <TouchableOpacity style={s.iconBtn} onPress={() => setShowTilt(v => !v)} activeOpacity={0.7}>
              <Text style={{ fontSize: 16, color: showTilt ? '#e8ff47' : '#888' }}>📐</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={s.bottomPanel}>
        <View style={s.sliderRow}>
          <Text style={s.sliderLabel}>GHOST</Text>
          <TouchableOpacity style={[s.modeBtn, ghostMode === 'first' && s.modeBtnActive]} onPress={() => setGhostMode('first')} activeOpacity={0.8}>
            <Text style={[s.modeBtnText, ghostMode === 'first' && s.modeBtnTextActive]}>PRIMERA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.modeBtn, ghostMode === 'previous' && s.modeBtnActive]} onPress={() => setGhostMode('previous')} activeOpacity={0.8}>
            <Text style={[s.modeBtnText, ghostMode === 'previous' && s.modeBtnTextActive]}>ANTERIOR</Text>
          </TouchableOpacity>
        </View>
        <View style={s.sliderRow}>
          <Text style={s.sliderLabel}>OPACIDAD</Text>
          <Slider
            style={{ flex: 1 }}
            minimumValue={0} maximumValue={1} value={opacity}
            onValueChange={setOpacity}
            minimumTrackTintColor="#e8ff47" maximumTrackTintColor="#222" thumbTintColor="#e8ff47"
            disabled={!ghostUri}
          />
          <Text style={s.sliderValue}>{Math.round(opacity * 100)}%</Text>
        </View>
        <View style={s.controlsRow}>
          <TouchableOpacity style={[s.thumb, ghostUri && s.thumbActive]} onPress={() => setShowGallery(true)} activeOpacity={0.8}>
            {ghostUri
              ? <Image source={{ uri: ghostUri }} style={s.thumbImg} resizeMode="cover" />
              : <Text style={{ fontSize: 22, opacity: 0.3 }}>🖼️</Text>
            }
            {photos.length > 0 && (
              <View style={s.photoBadge}><Text style={s.photoBadgeText}>{photos.length}</Text></View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={s.shutter} onPress={capturePhoto} activeOpacity={0.85} />
          <View style={s.rightControls}>
            <TouchableOpacity style={[s.toggleBtn, !ghostUri && s.disabled]} onPress={() => ghostUri && setGhostOn(g => !g)} activeOpacity={0.8}>
              <View style={[s.toggleTrack, ghostOn && s.toggleTrackOn]}>
                <View style={[s.toggleThumb, ghostOn && s.toggleThumbOn]} />
              </View>
              <Text style={[s.toggleLabel, ghostOn && s.toggleLabelOn]}>GHOST</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.clearBtn, !ghostUri && s.disabled]}
              onPress={() => ghostUri && Alert.alert('Borrar ghost', '¿Borrar la imagen fantasma activa?', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Borrar', style: 'destructive', onPress: () => updateProject({ ghostUri: null, ghostTilt: null }).then(() => setGhostOn(false)) }
              ])}
              activeOpacity={0.8}
            >
              <View style={[s.clearIcon, ghostUri && s.clearIconActive]}>
                <Text style={{ fontSize: 16 }}>🗑️</Text>
              </View>
              <Text style={[s.clearLabel, ghostUri && s.clearLabelActive]}>BORRAR</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const ab = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelBox: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 52 },
  label: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  arrow: { fontSize: 14, fontWeight: '700' },
  barTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  deg: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, minWidth: 28, textAlign: 'right' },
});

const tg = StyleSheet.create({
  panel: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 8, minWidth: 220 },
  panelAligned: { borderColor: 'rgba(80,220,100,0.5)', backgroundColor: 'rgba(0,0,0,0.35)' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
});

const ACCENT = '#e8ff47';
const ACCENT2 = '#ff6b35';
const BG = '#0a0a0a';
const SURFACE = '#111';
const BORDER = '#222';
const MUTED = '#555';
const TEXT = '#f0f0f0';
const GREEN = '#50dc64';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  galleryHeader: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  galleryBack: { fontSize: 16, color: ACCENT, fontWeight: '600' },
  galleryTitle: { fontSize: 16, fontWeight: '700', color: TEXT },
  timelapseBtn: { backgroundColor: 'rgba(232,255,71,0.1)', borderWidth: 1, borderColor: 'rgba(232,255,71,0.3)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  timelapseBtnText: { fontSize: 12, fontWeight: '600', color: ACCENT },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
  gridItem: { width: '33.33%', aspectRatio: 1, padding: 1, borderWidth: 2, borderColor: 'transparent' },
  gridItemActive: { borderColor: ACCENT },
  gridImg: { width: '100%', height: '100%' },
  ghostBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: ACCENT, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  ghostBadgeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 8, fontWeight: '700', color: '#000' },
  photoNumber: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  photoNumberText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, color: '#fff' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: TEXT },
  emptySubtext: { fontSize: 14, color: MUTED },
  hint: { textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: MUTED, paddingVertical: 14 },
  viewfinder: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff', opacity: 0.7, zIndex: 50 },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: ACCENT, borderStyle: 'solid', zIndex: 10 },
  cornerAligned: { borderColor: GREEN },
  tl: { top: 56, left: 16, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: 56, right: 16, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: 16, left: 16, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: 16, right: 16, borderBottomWidth: 2, borderRightWidth: 2 },
  crosshairH: { position: 'absolute', top: '50%', left: '50%', width: 20, height: 1, backgroundColor: 'rgba(232,255,71,0.6)', marginLeft: -10, zIndex: 10 },
  crosshairV: { position: 'absolute', top: '50%', left: '50%', width: 1, height: 20, backgroundColor: 'rgba(232,255,71,0.6)', marginTop: -10, zIndex: 10 },
  tiltContainer: { position: 'absolute', bottom: 24, alignSelf: 'center', zIndex: 20 },
  projectBadge: { position: 'absolute', top: 56, left: 72, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: BORDER, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 3, zIndex: 20 },
  projectBadgeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 2, color: TEXT },
  ghostLabel: { position: 'absolute', top: 56, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(232,255,71,0.3)', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 3, zIndex: 20 },
  ghostLabelText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 2, color: ACCENT },
  savingBadge: { position: 'absolute', bottom: 80, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(232,255,71,0.3)', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 4, zIndex: 20 },
  savingText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 2, color: ACCENT },
  backBtn: { position: 'absolute', top: 54, left: 16, zIndex: 20, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 22, color: '#fff', fontWeight: '300', lineHeight: 26 },
  topRight: { position: 'absolute', top: 52, right: 16, zIndex: 20, flexDirection: 'column', gap: 8 },
  iconBtn: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bottomPanel: { backgroundColor: 'rgba(10,10,10,0.92)', borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, gap: 16 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sliderLabel: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 2, color: MUTED, minWidth: 68 },
  sliderValue: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, color: ACCENT, minWidth: 38, textAlign: 'right' },
  modeBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  modeBtnActive: { borderColor: ACCENT, backgroundColor: 'rgba(232,255,71,0.1)' },
  modeBtnText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, letterSpacing: 1, color: MUTED },
  modeBtnTextActive: { color: ACCENT },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumb: { width: 52, height: 52, borderRadius: 6, overflow: 'visible', borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE },
  thumbActive: { borderColor: ACCENT },
  thumbImg: { width: '100%', height: '100%', borderRadius: 4 },
  photoBadge: { position: 'absolute', bottom: -6, right: -6, backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  photoBadgeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, fontWeight: '700', color: '#000' },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', borderWidth: 4, borderColor: BG },
  rightControls: { flexDirection: 'column', alignItems: 'center', gap: 10 },
  toggleBtn: { alignItems: 'center', gap: 4 },
  toggleTrack: { width: 42, height: 24, borderRadius: 12, backgroundColor: BORDER, justifyContent: 'center', paddingHorizontal: 3 },
  toggleTrackOn: { backgroundColor: ACCENT },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleThumbOn: { alignSelf: 'flex-end', backgroundColor: '#000' },
  toggleLabel: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, letterSpacing: 1, color: MUTED },
  toggleLabelOn: { color: ACCENT },
  clearBtn: { alignItems: 'center', gap: 4 },
  clearIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: SURFACE, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  clearIconActive: { borderColor: ACCENT2 },
  clearLabel: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, letterSpacing: 1, color: MUTED },
  clearLabelActive: { color: ACCENT2 },
  disabled: { opacity: 0.35 },
  permScreen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permHeading: { fontSize: 26, fontWeight: '700', color: TEXT, textAlign: 'center', marginBottom: 12 },
  permDesc: { fontSize: 15, color: MUTED, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  grantBtn: { paddingVertical: 18, paddingHorizontal: 40, backgroundColor: ACCENT, borderRadius: 14 },
  grantBtnText: { fontSize: 16, fontWeight: '700', color: '#000' },
});
