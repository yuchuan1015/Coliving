import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./guards/ProtectedRoute";
import { AdoptPage } from "./pages/AdoptPage";
import { ChatPage } from "./pages/ChatPage";
import { EditAgentPage } from "./pages/EditAgentPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PlazaPage } from "./pages/PlazaPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResidentsPage } from "./pages/ResidentsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/adopt" element={<AdoptPage />} />
              <Route path="/chat/:agentId" element={<ChatPage />} />
              <Route path="/agent/edit" element={<EditAgentPage />} />
              <Route path="/plaza" element={<PlazaPage />} />
              <Route path="/residents" element={<ResidentsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
