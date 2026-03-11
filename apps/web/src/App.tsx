import { BrowserRouter, Routes, Route } from 'react-router';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ThesisDetailPage } from './pages/ThesisDetailPage';
import { ResearchPage } from './pages/ResearchPage';
import { CompliancePage } from './pages/CompliancePage';
import { LatexPage } from './pages/LatexPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/thesis/:thesisId" element={<ThesisDetailPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/latex" element={<LatexPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
