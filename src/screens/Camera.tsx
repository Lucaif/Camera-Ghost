import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { loadProjects, saveProjects } from '../storage';
import type { Project, Tilt } from '../types';

const THRESHOLD = 0.04;
const GHOST_MODE_KEY = 'ghost_mode';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function AxisBar({ label, diff, arrow }: { label: string; diff: number; arrow: string }) {
  const abs = Math.abs(diff);
  const aligned = abs < THRESHOLD;
  const t = clamp(abs / 0.3, 0, 1);
  const r = aligned ? 100 : Math.round(232 * t + 80 * (1 - t));
  const g = aligned ? 220 : Math.round(80 * (1 - t));
  const b = aligned ? 71 : 0;
  const color = `rgb(${r},${g},${b})`;
  const degrees = Math.round(Math.asin(clamp(abs, -1, 1)) * (180 / Math.PI));
  return (
    <div className="tilt-row">
      <div className="tilt-label-box">
        <span className="tilt-label" style={{ color }}>{label}</span>
        <span className="tilt-arrow" style={{ color }}>{aligned ? '●' : arrow}</span>
      </div>
      <div className="tilt-bar-track">
        <div
          className="tilt-bar-fill"
          style={{
            width: `${aligned ? 100 : clamp((degrees / 45) * 100, 0, 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span className="tilt-deg" style={{ color }}>{aligned ? '0°' : `${degrees}°`}</span>
    </div>
  );
}

function TiltGuide({ current, target, aligned }: { current: Tilt; target: Tilt; aligned: boolean }) {
  const dx = target.z - current.z;
  const dz = target.x - current.x;
  return (
    <div className={`tilt-panel${aligned ? ' aligned' : ''}`}>
      <AxisBar label="TILT" diff={dx} arrow={dx > 0 ? '↑' : '↓'} />
      <div className="tilt-divider" />
      <AxisBar label="ROT" diff={dz} arrow={dz > 0 ? '↻' : '↺'} />
    </div>
  );
}

export default function Camera() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [camPerm, setCamPerm] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [streamError, setStreamError] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ghostOn, setGhostOn] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [flash, setFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tilt, setTilt] = useState<Tilt>({ x: 0, y: 0, z: 0 });
  const [tiltActive, setTiltActive] = useState(false);
  const [showTilt, setShowTilt] = useState(true);
  const [ghostMode, setGhostMode] = useState<'first' | 'previous'>('first');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const projectsCacheRef = useRef<Project[] | null>(null);

  // Persisted ghost mode
  useEffect(() => {
    const v = localStorage.getItem(GHOST_MODE_KEY);
    if (v === 'first' || v === 'previous') setGhostMode(v);
  }, []);

  // Load project
  useEffect(() => {
    loadProjects().then(projects => {
      projectsCacheRef.current = projects;
      const p = projects.find(p => p.id === id);
      if (p) {
        setProject(p);
        if (p.ghostUri) setGhostOn(true);
      }
    });
  }, [id]);

  // Tilt sensor (DeviceMotionEvent normalized to g-units)
  useEffect(() => {
    const handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || (a.x == null && a.y == null && a.z == null)) return;
      setTiltActive(true);
      setTilt({
        x: (a.x ?? 0) / 9.81,
        y: (a.y ?? 0) / 9.81,
        z: (a.z ?? 0) / 9.81,
      });
    };
    window.addEventListener('devicemotion', handler);
    return () => window.removeEventListener('devicemotion', handler);
  }, []);

  async function requestMotionPermission() {
    const DME = (window as unknown as {
      DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
    }).DeviceMotionEvent;
    if (!DME?.requestPermission) return;
    try { await DME.requestPermission(); } catch { /* ignore */ }
  }

  // Start the camera
  const startCamera = useCallback(async (mode?: 'environment' | 'user') => {
    const wantFacing = mode ?? facing;
    setCamPerm('requesting');
    setStreamError(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamPerm('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: wantFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamPerm('granted');
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setCamPerm('denied');
      } else {
        setCamPerm('unavailable');
        setStreamError(e?.message ?? String(e));
      }
    }
  }, [facing]);

  // Auto-start if camera permission was previously granted
  useEffect(() => {
    if (camPerm !== 'idle') return;
    const perms = navigator.permissions;
    if (!perms) return;
    (perms.query as (d: { name: PermissionName }) => Promise<PermissionStatus>)(
      { name: 'camera' as PermissionName }
    ).then(r => {
      if (r.state === 'granted') startCamera();
    }).catch(() => { /* not supported */ });
  }, [camPerm, startCamera]);

  // Cleanup on unmount
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  async function updateProject(updates: Partial<Project>) {
    const projects = projectsCacheRef.current ?? await loadProjects();
    const updated = projects.map(p => p.id === id ? { ...p, ...updates } : p);
    projectsCacheRef.current = updated;
    await saveProjects(updated);
    setProject(prev => prev ? { ...prev, ...updates } : prev);
  }

  function changeGhostMode(mode: 'first' | 'previous') {
    setGhostMode(mode);
    localStorage.setItem(GHOST_MODE_KEY, mode);
    const photos = project?.photos ?? [];
    if (photos.length === 0) return;
    if (mode === 'first') {
      updateProject({ ghostUri: photos[0], ghostTilt: project?.ghostTilt ?? null });
    } else {
      const last = photos[photos.length - 1];
      updateProject({ ghostUri: last, ghostTilt: project?.ghostTilt ?? null });
    }
    setGhostOn(true);
  }

  async function flipCamera() {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    await startCamera(next);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || saving || !video.videoWidth) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    try {
      setSaving(true);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      if (facing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0);
      const dataURL = canvas.toDataURL('image/jpeg', 0.9);

      const currentPhotos = project?.photos ?? [];
      const isFirstPhoto = currentPhotos.length === 0;
      const newGhostUri = ghostMode === 'first'
        ? (isFirstPhoto ? dataURL : project?.ghostUri ?? dataURL)
        : dataURL;
      const newGhostTilt: Tilt = ghostMode === 'first'
        ? (isFirstPhoto ? { ...tilt } : project?.ghostTilt ?? { ...tilt })
        : { ...tilt };
      await updateProject({
        ghostUri: newGhostUri,
        ghostTilt: newGhostTilt,
        photos: [...currentPhotos, dataURL],
      });
      setGhostOn(true);
    } catch (e) {
      console.warn('Error al capturar:', e);
    } finally {
      setSaving(false);
    }
  }

  async function clearGhost() {
    if (!window.confirm('¿Borrar la imagen fantasma activa?')) return;
    await updateProject({ ghostUri: null, ghostTilt: null });
    setGhostOn(false);
  }

  const ghostUri = project?.ghostUri ?? null;
  const ghostTilt = project?.ghostTilt ?? null;
  const photos = project?.photos ?? [];
  const isAligned = !!(
    ghostTilt &&
    Math.abs(ghostTilt.z - tilt.z) < THRESHOLD &&
    Math.abs(ghostTilt.x - tilt.x) < THRESHOLD
  );

  // ── Permission screen ─────────────────────────────────
  if (camPerm === 'idle' || camPerm === 'requesting') {
    return (
      <div className="screen">
        <div className="perm-screen">
          <div className="perm-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <div className="perm-tag">GHOST CAMERA</div>
          <div className="perm-heading">Acceso a la<br/>cámara</div>
          <div className="perm-desc">Para superponer fotos y alinear perspectivas, Ghost Camera necesita acceder a tu cámara.</div>
          <button className="grant-btn" onClick={() => startCamera()}>
            Permitir acceso a la cámara
          </button>
          <div className="perm-note">Solo se usa localmente.<br/>Ninguna foto sale de tu dispositivo.</div>
        </div>
      </div>
    );
  }

  if (camPerm === 'denied' || camPerm === 'unavailable') {
    return (
      <div className="screen">
        <div className="error-screen">
          <div className="error-icon">!</div>
          <div className="perm-heading" style={{ fontSize: 22 }}>
            {camPerm === 'denied' ? 'Acceso denegado' : 'Cámara no disponible'}
          </div>
          <div className="perm-desc">
            {camPerm === 'denied'
              ? 'Tu navegador bloqueó el acceso a la cámara. Activa el permiso en los ajustes del sitio y reintenta.'
              : streamError ?? 'No se encontró ninguna cámara. Asegúrate de que el sitio se sirve por HTTPS.'}
          </div>
          <button className="retry-btn" onClick={() => startCamera()}>Reintentar</button>
          <button
            className="retry-btn"
            style={{ marginTop: 12, color: 'var(--muted)', borderColor: 'var(--border)' }}
            onClick={() => navigate('/')}
          >‹ Volver a proyectos</button>
        </div>
      </div>
    );
  }

  // ── Camera view ───────────────────────────────────────
  return (
    <div className="screen">
      <div className="viewfinder">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={facing === 'user' ? 'mirrored' : ''}
        />
        {ghostUri && ghostOn && (
          <img className="ghost-img" src={ghostUri} alt="" style={{ opacity }} />
        )}
        {flash && <div className="flash" />}

        <div className={`corner tl${isAligned ? ' aligned' : ''}`} />
        <div className={`corner tr${isAligned ? ' aligned' : ''}`} />
        <div className={`corner bl${isAligned ? ' aligned' : ''}`} />
        <div className={`corner br${isAligned ? ' aligned' : ''}`} />
        <div className="crosshair-h" />
        <div className="crosshair-v" />

        {ghostTilt && showTilt && (
          <div className="tilt-container">
            {tiltActive ? (
              <TiltGuide current={tilt} target={ghostTilt} aligned={isAligned} />
            ) : (
              <button className="tilt-grant-btn" onClick={requestMotionPermission}>
                📐 Activar sensor de inclinación
              </button>
            )}
          </div>
        )}

        <div className="project-badge">{project?.name ?? ''}</div>
        {ghostOn && <div className="ghost-label">GHOST ON</div>}
        {saving && <div className="saving-badge">GUARDANDO...</div>}

        <button className="back-btn icon-btn" onClick={() => navigate('/')}>‹</button>
        <div className="top-right">
          <button className="icon-btn" onClick={flipCamera}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          {ghostTilt && (
            <button
              className={`icon-btn ${showTilt ? 'active' : ''}`}
              onClick={() => setShowTilt(v => !v)}
              style={{ color: showTilt ? 'var(--accent)' : '#888' }}
            >📐</button>
          )}
        </div>
      </div>

      <div className="bottom-panel">
        <div className="slider-row">
          <span className="slider-label">GHOST</span>
          <button
            className={`mode-btn${ghostMode === 'first' ? ' active' : ''}`}
            onClick={() => changeGhostMode('first')}
          >PRIMERA</button>
          <button
            className={`mode-btn${ghostMode === 'previous' ? ' active' : ''}`}
            onClick={() => changeGhostMode('previous')}
          >ANTERIOR</button>
        </div>
        <div className="slider-row">
          <span className="slider-label">OPACIDAD</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            disabled={!ghostUri}
          />
          <span className="slider-value">{Math.round(opacity * 100)}%</span>
        </div>
        <div className="controls-row">
          <button
            className={`thumb-btn${ghostUri ? ' has-ghost' : ''}`}
            onClick={() => navigate(`/gallery/${id}`)}
          >
            {ghostUri
              ? <img src={ghostUri} alt="" />
              : <span style={{ fontSize: 22, opacity: 0.3 }}>🖼️</span>}
            {photos.length > 0 && <span className="photo-badge">{photos.length}</span>}
          </button>
          <button className="shutter" onClick={capturePhoto} aria-label="Capturar" />
          <div className="right-controls">
            <button
              className={`toggle-btn${ghostUri ? ' enabled' : ''}${ghostOn ? ' on' : ''}`}
              onClick={() => ghostUri && setGhostOn(v => !v)}
              disabled={!ghostUri}
            >
              <div className="toggle-track">
                <div className="toggle-thumb" />
              </div>
              <span className="toggle-label">GHOST</span>
            </button>
            <button
              className={`clear-btn${ghostUri ? ' enabled' : ''}`}
              onClick={() => ghostUri && clearGhost()}
              disabled={!ghostUri}
            >
              <div className="clear-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
              </div>
              <span className="clear-label">BORRAR</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
