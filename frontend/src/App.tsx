import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./guards/ProtectedRoute";
import { AdoptPage } from "./pages/AdoptPage";
import { AdminPage } from "./pages/AdminPage";
import { ChatPage } from "./pages/ChatPage";
import { EditAgentPage } from "./pages/EditAgentPage";
import { AdvancedAgentPage } from "./pages/AdvancedAgentPage";
import { FurniturePage } from "./pages/FurniturePage";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PlazaPage } from "./pages/PlazaPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResidentsPage } from "./pages/ResidentsPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { DiaryPage } from "./pages/DiaryPage";
import { DrawerPage } from "./pages/DrawerPage";
import { PhotoFramePage } from "./pages/PhotoFramePage";
import { MailboxPage } from "./pages/MailboxPage";
import { BookshelfPage } from "./pages/BookshelfPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReadingShelfPage } from "./pages/ReadingShelfPage";
import { ReadingPage } from "./pages/ReadingPage";

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
              <Route path="/home/diary" element={<DiaryPage />} />
              <Route path="/home/drawer" element={<DrawerPage />} />
              <Route path="/home/photos" element={<PhotoFramePage />} />
              <Route path="/home/library" element={<BookshelfPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/reading" element={<ReadingShelfPage />} />
              <Route path="/reading/:bookId" element={<ReadingPage />} />
              <Route path="/mailbox" element={<MailboxPage />} />
              <Route path="/home/:moduleId" element={<FurniturePage />} />
              <Route path="/outside" element={<DashboardPage />} />
              <Route path="/adopt" element={<AdoptPage />} />
              <Route path="/chat/:agentId" element={<ChatPage />} />
              <Route path="/agent/edit" element={<EditAgentPage />} />
              <Route path="/agent/advanced" element={<AdvancedAgentPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
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
