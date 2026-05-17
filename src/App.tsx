import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Projects from './screens/Projects';
import Camera from './screens/Camera';
import Gallery from './screens/Gallery';
import Timelapse from './screens/Timelapse';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Projects />} />
        <Route path="/camera/:id" element={<Camera />} />
        <Route path="/gallery/:id" element={<Gallery />} />
        <Route path="/timelapse/:id" element={<Timelapse />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
