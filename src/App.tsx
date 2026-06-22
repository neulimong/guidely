
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SearchPage from './pages/SearchPage';
import SOPPage from './pages/SOPPage';
import ChecklistPage from './pages/ChecklistPage';
import CSPage from './pages/CSPage';
import UploadPage from './pages/UploadPage';
import { ToastProvider } from './components/ui/ToastContext';
import './App.css';

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/search" replace />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="sop" element={<SOPPage />} />
            <Route path="checklist" element={<ChecklistPage />} />
            <Route path="cs" element={<CSPage />} />
            <Route path="upload" element={<UploadPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
