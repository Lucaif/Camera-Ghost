import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadProjects, saveProjects } from '../storage';
import type { Project } from '../types';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    loadProjects().then(setProjects);
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  async function createProject() {
    const name = window.prompt('Nombre del proyecto:');
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
    await saveProjects(updated);
  }

  async function deleteProject(id: string) {
    if (!window.confirm('¿Seguro que quieres borrar este proyecto?')) return;
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    await saveProjects(updated);
  }

  return (
    <div className="screen">
      <div className="projects-header">
        <div className="projects-tag">GHOST CAMERA</div>
        <div className="projects-title">Proyectos</div>
      </div>

      {projects.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon">👻</div>
          <div className="projects-empty-text">Sin proyectos todavía</div>
          <div className="projects-empty-sub">Crea uno para empezar</div>
        </div>
      ) : (
        <div className="scroll">
          <div className="projects-list">
            {projects.map(item => (
              <button
                key={item.id}
                className="project-card"
                onClick={async () => {
                  // Pre-grant iOS motion permission while we still have a user gesture,
                  // so the tilt sensor is ready by the time Camera mounts.
                  const DME = (window as unknown as {
                    DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
                  }).DeviceMotionEvent;
                  if (DME?.requestPermission) {
                    try { await DME.requestPermission(); } catch { /* ignore */ }
                  }
                  navigate(`/camera/${item.id}`);
                }}
              >
                <div className="project-thumb">
                  {item.ghostUri ? (
                    <img src={item.ghostUri} alt="" />
                  ) : (
                    <span style={{ fontSize: 24 }}>👻</span>
                  )}
                </div>
                <div className="project-info">
                  <div className="project-name">{item.name}</div>
                  <div className="project-sub">
                    {item.ghostUri ? '● Ghost guardado' : '○ Sin ghost'}
                    {item.photos?.length
                      ? `  ·  ${item.photos.length} foto${item.photos.length > 1 ? 's' : ''}`
                      : ''}
                    {item.ghostTilt ? '  ·  📐' : ''}
                  </div>
                </div>
                <span
                  className="project-delete"
                  onClick={(e) => { e.stopPropagation(); deleteProject(item.id); }}
                  role="button"
                  aria-label="Borrar proyecto"
                >✕</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="new-btn" onClick={createProject}>+ Nuevo proyecto</button>
      <div className="hint">Toca la ✕ para borrar un proyecto</div>
    </div>
  );
}
