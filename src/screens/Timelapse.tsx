import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { loadProjects } from '../storage';
import type { Project } from '../types';
import { encodeGif } from '../gifEncoder';

const GIF_SIZE = 800;

export default function Timelapse() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fps, setFps] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [mode, setMode] = useState<'select' | 'play'>('select');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    loadProjects().then(projects => {
      const p = projects.find(p => p.id === id);
      if (p) setProject(p);
    });
  }, [id]);

  useEffect(() => {
    if (playing && selected.length > 1) {
      intervalRef.current = window.setInterval(() => {
        setCurrentFrame(f => (f + 1) % selected.length);
      }, 1000 / fps);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, fps, selected.length]);

  function toggleSelect(uri: string) {
    setSelected(prev => prev.includes(uri) ? prev.filter(u => u !== uri) : [...prev, uri]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setSelected(next);
  }

  function moveDown(index: number) {
    if (index === selected.length - 1) return;
    const next = [...selected];
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    setSelected(next);
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
      const blob = await encodeGif(selected, GIF_SIZE, Math.round(1000 / fps), setExportProgress);
      const file = new File([blob], `timelapse_${Date.now()}.gif`, { type: 'image/gif' });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: 'Timelapse' });
        } catch {
          // user dismissed — fall through to download
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e: any) {
      window.alert('Error generando GIF: ' + (e?.message ?? String(e)));
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const photos = project?.photos ?? [];

  // ── Player ─────────────────────────────────────────
  if (mode === 'play') {
    return (
      <div className="screen">
        <div className="tl-player">
          {selected[currentFrame] && <img src={selected[currentFrame]} alt="" />}
          <div className="tl-fps-badge">{fps} FPS</div>
          <div className="tl-frame-counter">{currentFrame + 1} / {selected.length}</div>
        </div>
        <div className="tl-player-panel">
          <div className="slider-row">
            <span className="slider-label">VELOCIDAD</span>
            <input
              type="range"
              min="1"
              max="24"
              step="1"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            />
            <span className="slider-value">{fps} fps</span>
          </div>
          <div className="tl-play-controls">
            <button className="tl-stop-btn" onClick={stopPlayback}>‹ Volver</button>
            <button
              className={`tl-play-pause${playing ? ' active' : ''}`}
              onClick={() => setPlaying(p => !p)}
            >{playing ? '⏸' : '▶'}</button>
            <div className="tl-step-btns">
              <button
                className="tl-step-btn"
                onClick={() => { setPlaying(false); setCurrentFrame(f => Math.max(0, f - 1)); }}
              >◀</button>
              <button
                className="tl-step-btn"
                onClick={() => { setPlaying(false); setCurrentFrame(f => Math.min(selected.length - 1, f + 1)); }}
              >▶</button>
            </div>
          </div>
          <button
            className={`tl-gif-btn${exporting ? ' disabled' : ''}`}
            onClick={exportGIF}
            disabled={exporting}
          >
            {exporting ? `Generando GIF... ${exportProgress}%` : '⬇ Exportar GIF'}
          </button>
          <div className="tl-filmstrip">
            {selected.map((uri, i) => (
              <button
                key={i}
                className={`tl-film-frame${i === currentFrame ? ' active' : ''}`}
                onClick={() => { setPlaying(false); setCurrentFrame(i); }}
              >
                <img src={uri} alt="" />
                <span className="tl-film-index">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Select & Order ─────────────────────────────────
  return (
    <div className="screen">
      <div className="tl-header">
        <button className="tl-back" onClick={() => navigate(-1)}>‹ Cámara</button>
        <div className="tl-header-center">
          <div className="tl-header-tag">TIMELAPSE</div>
          <div className="tl-header-title">{project?.name}</div>
        </div>
        <button
          className={`tl-play-btn${selected.length < 2 ? ' disabled' : ''}`}
          onClick={() => selected.length >= 2 && startPlayback()}
          disabled={selected.length < 2}
        >▶ Play</button>
      </div>
      <div className="tl-info-row">
        <span className="tl-info-text">{selected.length} seleccionada{selected.length !== 1 ? 's' : ''}</span>
        {selected.length < 2 && <span className="tl-info-hint">Mín. 2</span>}
        <button className="tl-select-btn" onClick={() => setSelected([...photos])}>Todas</button>
        <button className="tl-select-btn" onClick={() => setSelected([])}>Ninguna</button>
      </div>

      <div className="scroll">
        {selected.length > 0 && (
          <div className="tl-section">
            <div className="tl-section-title">ORDEN</div>
            {selected.map((uri, i) => (
              <div key={uri} className="tl-order-row">
                <span className="tl-order-index">{i + 1}</span>
                <img className="tl-order-thumb" src={uri} alt="" />
                <div className="tl-order-arrows">
                  <button
                    className={`tl-arrow-btn${i === 0 ? ' disabled' : ''}`}
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                  >↑</button>
                  <button
                    className={`tl-arrow-btn${i === selected.length - 1 ? ' disabled' : ''}`}
                    onClick={() => moveDown(i)}
                    disabled={i === selected.length - 1}
                  >↓</button>
                </div>
                <button className="tl-remove-btn" onClick={() => toggleSelect(uri)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="tl-section">
          <div className="tl-section-title">FOTOS DEL PROYECTO</div>
          {photos.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Sin fotos todavía</div>
          ) : (
            <div className="tl-grid">
              {photos.map((uri, i) => {
                const isSelected = selected.includes(uri);
                const orderIndex = selected.indexOf(uri);
                return (
                  <button
                    key={i}
                    className={`tl-grid-cell${isSelected ? ' selected' : ''}`}
                    onClick={() => toggleSelect(uri)}
                  >
                    <img src={uri} alt="" />
                    {isSelected && <span className="tl-grid-badge">{orderIndex + 1}</span>}
                    <span className="tl-grid-number">{i + 1}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
