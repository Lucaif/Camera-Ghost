import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { loadProjects, saveProjects } from '../storage';
import type { Project } from '../types';

export default function Gallery() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadProjects().then(projects => {
      const p = projects.find(p => p.id === id);
      if (p) setProject(p);
    });
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  async function setAsGhost(uri: string) {
    const projects = await loadProjects();
    const updated = projects.map(p => p.id === id ? { ...p, ghostUri: uri } : p);
    await saveProjects(updated);
    setProject(prev => prev ? { ...prev, ghostUri: uri } : prev);
    setSelected(null);
  }

  async function deletePhoto(uri: string) {
    if (!window.confirm('¿Borrar esta foto del proyecto?')) return;
    const projects = await loadProjects();
    const updated = projects.map(p => {
      if (p.id !== id) return p;
      const photos = p.photos.filter(u => u !== uri);
      const ghostUri = p.ghostUri === uri ? (photos[photos.length - 1] ?? null) : p.ghostUri;
      return { ...p, photos, ghostUri };
    });
    await saveProjects(updated);
    refresh();
    setSelected(null);
  }

  const photos = project?.photos ?? [];

  return (
    <div className="screen">
      <div className="gallery-header">
        <button className="gallery-back" onClick={() => navigate(-1)}>‹ Cámara</button>
        <div className="gallery-center">
          <div className="gallery-title">{project?.name ?? ''}</div>
          <div className="gallery-sub">{photos.length} foto{photos.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ width: 70 }} />
      </div>

      {photos.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon">📷</div>
          <div className="projects-empty-text">Sin fotos todavía</div>
          <div className="projects-empty-sub">Haz fotos desde la cámara</div>
        </div>
      ) : (
        <div className="scroll">
          <div className="photo-grid">
            {[...photos].reverse().map((uri, i) => (
              <button
                key={uri + i}
                className="photo-cell"
                onClick={() => setSelected(uri)}
              >
                <img src={uri} alt="" />
                {project?.ghostUri === uri && <span className="ghost-badge">GHOST</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-back">
          <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
          <img className="modal-img" src={selected} alt="" />
          <div className="modal-actions">
            <button className="modal-btn" onClick={() => setAsGhost(selected)}>👻 Usar como Ghost</button>
            <button className="modal-btn danger" onClick={() => deletePhoto(selected)}>🗑️ Borrar foto</button>
          </div>
        </div>
      )}
    </div>
  );
}
