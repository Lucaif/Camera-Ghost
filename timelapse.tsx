import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Image, Platform, ScrollView, StatusBar,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import Slider from '@react-native-community/slider';
import WebView from 'react-native-webview';
import { loadProjects, Project } from './(tabs)/index';

const GIF_SIZE = 800;

function buildGifHtml(frames: string[], delay: number): string {
  const framesJson = JSON.stringify(frames);
  const delayVal = Math.round(delay / 10);

  return `<!DOCTYPE html>
<html><body>
<canvas id="c" width="${GIF_SIZE}" height="${GIF_SIZE}" style="display:none"></canvas>
<script>
(function() {

// ── ByteArray ─────────────────────────────────────────
function ByteArray() { this.data = []; }
ByteArray.prototype.writeByte = function(b) { this.data.push(b & 0xFF); };
ByteArray.prototype.writeShort = function(s) { this.writeByte(s); this.writeByte(s >> 8); };
ByteArray.prototype.writeBytes = function(a, off, len) {
  off = off || 0; len = len !== undefined ? len : a.length;
  for (var i = off; i < off + len; i++) this.writeByte(a[i]);
};
ByteArray.prototype.toBase64 = function() {
  // Convertir en chunks de 8192 para evitar crashes de memoria
  var s = '', d = this.data, chunk = 8192;
  for (var i = 0; i < d.length; i += chunk) {
    s += btoa(String.fromCharCode.apply(null, d.slice(i, i + chunk)));
  }
  return s;
};

// ── Paleta 216 colores (6x6x6) + 40 grises ───────────
var PALETTE = (function() {
  var p = [];
  for (var r = 0; r < 6; r++)
    for (var g = 0; g < 6; g++)
      for (var b = 0; b < 6; b++)
        p.push(Math.round(r*255/5), Math.round(g*255/5), Math.round(b*255/5));
  for (var i = 0; i < 40; i++) {
    var v = Math.round(i * 255 / 39);
    p.push(v, v, v);
  }
  while (p.length < 768) p.push(0);
  return p;
})();

// ── Lookup table precalculada (r>>3, g>>3, b>>3) → índice paleta ──
// Divide el espacio RGB en cubos de 8 y precalcula el color más cercano
var LUT = (function() {
  var lut = new Uint8Array(32 * 32 * 32);
  for (var ri = 0; ri < 32; ri++) {
    for (var gi = 0; gi < 32; gi++) {
      for (var bi = 0; bi < 32; bi++) {
        var r = ri * 8, g = gi * 8, b = bi * 8;
        var best = 0, bestD = Infinity;
        for (var i = 0; i < 256; i++) {
          var dr = r - PALETTE[i*3], dg = g - PALETTE[i*3+1], db = b - PALETTE[i*3+2];
          var d = dr*dr + dg*dg + db*db;
          if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
        }
        lut[(ri << 10) | (gi << 5) | bi] = best;
      }
    }
  }
  return lut;
})();

function nearestColor(r, g, b) {
  return LUT[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}

// ── Floyd-Steinberg dithering ─────────────────────────
function quantize(pixels, w, h) {
  var buf = new Float32Array(w * h * 3);
  for (var i = 0; i < w * h; i++) {
    buf[i*3]   = pixels[i*4];
    buf[i*3+1] = pixels[i*4+1];
    buf[i*3+2] = pixels[i*4+2];
  }
  var indexed = new Uint8Array(w * h);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var idx = (y * w + x) * 3;
      var r = Math.max(0, Math.min(255, buf[idx]   + 0.5) | 0);
      var g = Math.max(0, Math.min(255, buf[idx+1] + 0.5) | 0);
      var b = Math.max(0, Math.min(255, buf[idx+2] + 0.5) | 0);
      var ci = nearestColor(r, g, b);
      indexed[y * w + x] = ci;
      var er = r - PALETTE[ci*3];
      var eg = g - PALETTE[ci*3+1];
      var eb = b - PALETTE[ci*3+2];
      if (x + 1 < w) {
        buf[idx+3] += er * 0.4375;
        buf[idx+4] += eg * 0.4375;
        buf[idx+5] += eb * 0.4375;
      }
      if (y + 1 < h) {
        var row = ((y+1)*w + x)*3;
        if (x > 0) {
          buf[row-3] += er * 0.1875;
          buf[row-2] += eg * 0.1875;
          buf[row-1] += eb * 0.1875;
        }
        buf[row]   += er * 0.3125;
        buf[row+1] += eg * 0.3125;
        buf[row+2] += eb * 0.3125;
        if (x + 1 < w) {
          buf[row+3] += er * 0.0625;
          buf[row+4] += eg * 0.0625;
          buf[row+5] += eb * 0.0625;
        }
      }
    }
  }
  return indexed;
}

// ── LZW encoder con claves numéricas ─────────────────
function lzwEncode(pixels, minCodeSize, buf) {
  var clearCode = 1 << minCodeSize;
  var endCode = clearCode + 1;
  buf.writeByte(minCodeSize);

  var bits = new ByteArray();
  var bitBuf = 0, bitLen = 0;

  function writeBits(code, len) {
    bitBuf |= code << bitLen; bitLen += len;
    while (bitLen >= 8) { bits.writeByte(bitBuf & 0xFF); bitBuf >>= 8; bitLen -= 8; }
  }

  var table = new Int32Array(4096 * 256).fill(-1);
  var codeSize = minCodeSize + 1;
  var nextCode = endCode + 1;

  function resetTable() {
    table.fill(-1);
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  }

  writeBits(clearCode, codeSize);
  var str = pixels[0];

  for (var i = 1; i < pixels.length; i++) {
    var c = pixels[i];
    var key = str * 256 + c;
    var entry = table[key] !== undefined ? table[key] : -1;
    if (entry >= 0) {
      str = entry;
    } else {
      writeBits(str, codeSize);
      if (nextCode < 4096) {
        table[key] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        writeBits(clearCode, codeSize);
        resetTable();
      }
      str = c;
    }
  }
  writeBits(str, codeSize);
  writeBits(endCode, codeSize);
  if (bitLen > 0) bits.writeByte(bitBuf & 0xFF);

  var data = bits.data, j = 0;
  while (j < data.length) {
    var bs = Math.min(255, data.length - j);
    buf.writeByte(bs);
    for (var k = 0; k < bs; k++) buf.writeByte(data[j++]);
  }
  buf.writeByte(0);
}

// ── GIF Encoder ───────────────────────────────────────
function GifEncoder(w, h, delay) {
  this.w = w; this.h = h;
  this.delay = Math.round(delay / 10);
  this.buf = new ByteArray();
  this._first = true;
  // Cabecera GIF89a
  this.buf.writeBytes([0x47,0x49,0x46,0x38,0x39,0x61]);
}

GifEncoder.prototype.addFrame = function(imageData) {
  var indexed = quantize(imageData.data, this.w, this.h);

  if (this._first) {
    this._first = false;
    this.buf.writeShort(this.w); this.buf.writeShort(this.h);
    this.buf.writeByte(0xF7); this.buf.writeByte(0); this.buf.writeByte(0);
    for (var i = 0; i < 768; i++) this.buf.writeByte(PALETTE[i]);
    // Netscape loop extension
    this.buf.writeBytes([0x21,0xFF,0x0B,78,69,84,83,67,65,80,69,50,46,48,0x03,0x01,0,0,0]);
  }

  // Graphic control
  this.buf.writeBytes([0x21,0xF9,0x04,0x00]);
  this.buf.writeShort(this.delay);
  this.buf.writeByte(0); this.buf.writeByte(0);

  // Image descriptor
  this.buf.writeByte(0x2C);
  this.buf.writeShort(0); this.buf.writeShort(0);
  this.buf.writeShort(this.w); this.buf.writeShort(this.h);
  this.buf.writeByte(0);

  lzwEncode(indexed, 8, this.buf);
};

GifEncoder.prototype.finish = function() {
  this.buf.writeByte(0x3B);
  return this.buf.toBase64();
};

// ── Main ──────────────────────────────────────────────
var frames = ${framesJson};
var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var encoder = new GifEncoder(${GIF_SIZE}, ${GIF_SIZE}, ${delayVal} * 10);

function processFrame(index) {
  if (index >= frames.length) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'progress', value: 99 }));
    var b64 = encoder.finish();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'done', data: b64 }));
    return;
  }
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'progress', value: Math.round((index / frames.length) * 100)
  }));
  var img = new Image();
  img.onload = function() {
    ctx.clearRect(0, 0, ${GIF_SIZE}, ${GIF_SIZE});
    ctx.drawImage(img, 0, 0, ${GIF_SIZE}, ${GIF_SIZE});
    encoder.addFrame(ctx.getImageData(0, 0, ${GIF_SIZE}, ${GIF_SIZE}));
    setTimeout(function() { processFrame(index + 1); }, 0);
  };
  img.onerror = function() { processFrame(index + 1); };
  img.src = frames[index];
}

processFrame(0);

})();
</script>
</body></html>`;
}

export default function TimelapseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fps, setFps] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [mode, setMode] = useState<'select' | 'play'>('select');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [gifHtml, setGifHtml] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadProjects().then(projects => {
      const p = projects.find(p => p.id === id);
      if (p) setProject(p);
    });
  }, [id]);

  useEffect(() => {
    if (playing && selected.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentFrame(f => (f + 1) % selected.length);
      }, 1000 / fps);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, fps, selected.length]);

  function toggleSelect(uri: string) {
    setSelected(prev => prev.includes(uri) ? prev.filter(u => u !== uri) : [...prev, uri]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...selected];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setSelected(updated);
  }

  function moveDown(index: number) {
    if (index === selected.length - 1) return;
    const updated = [...selected];
    [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]];
    setSelected(updated);
  }

  function startPlayback() {
    setCurrentFrame(0);
    setMode('play');
    setPlaying(true);
  }

  function stopPlayback() {
    setPlaying(false);
    setMode('select');
    setCurrentFrame(0);
  }

  async function exportGIF() {
    if (selected.length < 2 || exporting) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const frames: string[] = [];
      for (let i = 0; i < selected.length; i++) {
        const resized = await ImageManipulator.manipulateAsync(
          selected[i],
          [{ resize: { width: GIF_SIZE, height: GIF_SIZE } }],
          { format: ImageManipulator.SaveFormat.PNG, base64: true }
        );
        if (resized.base64) frames.push(`data:image/png;base64,${resized.base64}`);
      }
      setGifHtml(buildGifHtml(frames, Math.round(1000 / fps)));
    } catch (e: any) {
      Alert.alert('Error', String(e?.message ?? e));
      setExporting(false);
    }
  }

  async function handleWebViewMessage(event: any) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'progress') {
        setExportProgress(msg.value);
      } else if (msg.type === 'done') {
        setGifHtml(null);
        const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
        const gifPath = dir + `timelapse_${Date.now()}.gif`;
        await FileSystem.writeAsStringAsync(gifPath, msg.data, {
          encoding: 'base64' as any,
        });
        setExporting(false);
        setExportProgress(0);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(gifPath, { mimeType: 'image/gif', dialogTitle: 'Compartir GIF' });
        }
      }
    } catch (e: any) {
      setGifHtml(null);
      setExporting(false);
      Alert.alert('Error detalle', String(e?.message ?? e));
    }
  }

  const photos = project?.photos ?? [];

  // ── Player ─────────────────────────────────────────────
  if (mode === 'play') {
    return (
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        {gifHtml && (
          <WebView
            style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }}
            source={{ html: gifHtml }}
            onMessage={handleWebViewMessage}
            originWhitelist={['*']}
            javaScriptEnabled
            onError={(e) => Alert.alert('WebView error', e.nativeEvent.description)}
          />
        )}
        <View style={s.player}>
          {selected[currentFrame] && (
            <Image source={{ uri: selected[currentFrame] }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          )}
          <View style={s.frameCounter}>
            <Text style={s.frameCounterText}>{currentFrame + 1} / {selected.length}</Text>
          </View>
          <View style={s.fpsBadge}>
            <Text style={s.fpsBadgeText}>{fps} FPS</Text>
          </View>
        </View>
        <View style={s.playerPanel}>
          <View style={s.sliderRow}>
            <Text style={s.sliderLabel}>VELOCIDAD</Text>
            <Slider
              style={{ flex: 1 }}
              minimumValue={1} maximumValue={24} step={1} value={fps}
              onValueChange={setFps}
              minimumTrackTintColor="#e8ff47" maximumTrackTintColor="#222" thumbTintColor="#e8ff47"
            />
            <Text style={s.sliderValue}>{fps} fps</Text>
          </View>
          <View style={s.playControls}>
            <TouchableOpacity style={s.stopBtn} onPress={stopPlayback} activeOpacity={0.8}>
              <Text style={s.stopBtnText}>‹ Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.playPauseBtn, playing && s.playPauseBtnActive]}
              onPress={() => setPlaying(p => !p)}
              activeOpacity={0.8}
            >
              <Text style={s.playPauseBtnText}>{playing ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <View style={s.stepBtns}>
              <TouchableOpacity style={s.stepBtn} onPress={() => { setPlaying(false); setCurrentFrame(f => Math.max(0, f - 1)); }} activeOpacity={0.8}>
                <Text style={s.stepBtnText}>◀</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.stepBtn} onPress={() => { setPlaying(false); setCurrentFrame(f => Math.min(selected.length - 1, f + 1)); }} activeOpacity={0.8}>
                <Text style={s.stepBtnText}>▶</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[s.gifBtn, exporting && s.gifBtnDisabled]}
            onPress={exportGIF}
            activeOpacity={0.85}
            disabled={exporting}
          >
            <Text style={s.gifBtnText}>
              {exporting ? `Generando GIF... ${exportProgress}%` : '⬇ Exportar GIF'}
            </Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filmstrip}>
            {selected.map((uri, i) => (
              <TouchableOpacity key={i} onPress={() => { setPlaying(false); setCurrentFrame(i); }} activeOpacity={0.8}>
                <View style={[s.filmFrame, i === currentFrame && s.filmFrameActive]}>
                  <Image source={{ uri }} style={s.filmImg} resizeMode="cover" />
                  <Text style={s.filmIndex}>{i + 1}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    );
  }

  // ── Select & Order ─────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.backBtn}>‹ Cámara</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTag}>TIMELAPSE</Text>
          <Text style={s.headerTitle}>{project?.name}</Text>
        </View>
        <TouchableOpacity
          style={[s.playBtn, selected.length < 2 && s.disabled]}
          onPress={() => selected.length >= 2 && startPlayback()}
          activeOpacity={0.8}
        >
          <Text style={s.playBtnText}>▶ Play</Text>
        </TouchableOpacity>
      </View>
      <View style={s.infoRow}>
        <Text style={s.infoText}>{selected.length} seleccionada{selected.length !== 1 ? 's' : ''}</Text>
        {selected.length < 2 && <Text style={s.infoHint}>Mín. 2</Text>}
        <TouchableOpacity onPress={() => setSelected([...photos])} activeOpacity={0.8}>
          <Text style={s.selectAllBtn}>Todas</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelected([])} activeOpacity={0.8}>
          <Text style={s.selectAllBtn}>Ninguna</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {selected.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>ORDEN</Text>
            {selected.map((uri, i) => (
              <View key={uri} style={s.orderRow}>
                <Text style={s.orderIndex}>{i + 1}</Text>
                <Image source={{ uri }} style={s.orderThumb} resizeMode="cover" />
                <View style={s.orderArrows}>
                  <TouchableOpacity onPress={() => moveUp(i)} activeOpacity={0.7} style={[s.arrowBtn, i === 0 && s.disabled]}>
                    <Text style={s.arrowText}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => moveDown(i)} activeOpacity={0.7} style={[s.arrowBtn, i === selected.length - 1 && s.disabled]}>
                    <Text style={s.arrowText}>↓</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => toggleSelect(uri)} activeOpacity={0.7} style={s.removeBtn}>
                  <Text style={s.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <View style={s.section}>
          <Text style={s.sectionTitle}>FOTOS DEL PROYECTO</Text>
          {photos.length === 0 ? (
            <Text style={s.emptyText}>Sin fotos todavía</Text>
          ) : (
            <View style={s.grid}>
              {photos.map((uri, i) => {
                const isSelected = selected.includes(uri);
                const orderIndex = selected.indexOf(uri);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.gridItem, isSelected && s.gridItemActive]}
                    onPress={() => toggleSelect(uri)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri }} style={s.gridImg} resizeMode="cover" />
                    {isSelected && (
                      <View style={s.gridBadge}>
                        <Text style={s.gridBadgeText}>{orderIndex + 1}</Text>
                      </View>
                    )}
                    <View style={s.gridNumber}>
                      <Text style={s.gridNumberText}>{i + 1}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
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
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { fontSize: 16, color: ACCENT, fontWeight: '600', minWidth: 70 },
  headerCenter: { alignItems: 'center' },
  headerTag: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, letterSpacing: 3, color: MUTED },
  headerTitle: { fontSize: 16, fontWeight: '700', color: TEXT },
  playBtn: { backgroundColor: ACCENT, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, minWidth: 70, alignItems: 'center' },
  playBtnText: { fontSize: 13, fontWeight: '700', color: '#000' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  infoText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: MUTED, flex: 1 },
  infoHint: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: '#ff6b35' },
  selectAllBtn: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, color: ACCENT, letterSpacing: 1 },
  section: { padding: 16, gap: 10 },
  sectionTitle: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, letterSpacing: 3, color: MUTED, marginBottom: 4 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: SURFACE, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: BORDER },
  orderIndex: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, color: ACCENT, minWidth: 20, textAlign: 'center' },
  orderThumb: { width: 48, height: 48, borderRadius: 4 },
  orderArrows: { flexDirection: 'column', gap: 4 },
  arrowBtn: { width: 28, height: 28, backgroundColor: BG, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  arrowText: { fontSize: 14, color: TEXT },
  removeBtn: { marginLeft: 'auto' as any, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: 14, color: MUTED },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%' },
  gridItem: { width: '33.33%', aspectRatio: 1, padding: 1, borderWidth: 2, borderColor: 'transparent' },
  gridItemActive: { borderColor: ACCENT },
  gridImg: { width: '100%', height: '100%' },
  gridBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: ACCENT, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  gridBadgeText: { fontSize: 10, fontWeight: '700', color: '#000' },
  gridNumber: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  gridNumberText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 9, color: '#fff' },
  emptyText: { color: MUTED, fontSize: 14 },
  player: { flex: 1, backgroundColor: '#000' },
  frameCounter: { position: 'absolute', top: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: BORDER },
  frameCounterText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, color: TEXT },
  fpsBadge: { position: 'absolute', top: 16, left: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(232,255,71,0.3)' },
  fpsBadgeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, color: ACCENT },
  playerPanel: { backgroundColor: 'rgba(10,10,10,0.95)', borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30, gap: 14 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sliderLabel: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 10, letterSpacing: 2, color: MUTED, minWidth: 76 },
  sliderValue: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, color: ACCENT, minWidth: 42, textAlign: 'right' },
  playControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stopBtn: { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  stopBtnText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  playPauseBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: SURFACE, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  playPauseBtnActive: { borderColor: ACCENT, backgroundColor: 'rgba(232,255,71,0.1)' },
  playPauseBtnText: { fontSize: 20, color: TEXT },
  stepBtns: { flexDirection: 'row', gap: 8, marginLeft: 'auto' as any },
  stepBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 14, color: TEXT },
  gifBtn: { backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  gifBtnDisabled: { backgroundColor: 'rgba(232,255,71,0.3)' },
  gifBtnText: { fontSize: 14, fontWeight: '700', color: '#000' },
  filmstrip: { flexGrow: 0 },
  filmFrame: { width: 52, height: 52, marginRight: 4, borderRadius: 4, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  filmFrameActive: { borderColor: ACCENT },
  filmImg: { width: '100%', height: '100%' },
  filmIndex: { position: 'absolute', bottom: 2, right: 3, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 8, color: '#fff' },
  disabled: { opacity: 0.35 },
});
