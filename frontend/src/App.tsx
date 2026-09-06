import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./guards/ProtectedRoute";
import { AdminPage } from "./pages/AdminPage";
import { AdoptPage } from "./pages/AdoptPage";
import { BookClubDetailPage } from "./pages/BookClubDetailPage";
import { ChatPage } from "./pages/ChatPage";
import { EditAgentPage } from "./pages/EditAgentPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { MailboxPage } from "./pages/MailboxPage";
import { MuseumPage } from "./pages/MuseumPage";
import { ParkPage } from "./pages/ParkPage";
import { PlazaPage } from "./pages/PlazaPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResidentPage } from "./pages/ResidentPage";
import { ResidentsPage } from "./pages/ResidentsPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SkinStorePage } from "./pages/SkinStorePage";
import { AdultPage } from "./pages/AdultPage";
import { HealthCenterPage } from "./pages/HealthCenterPage";
import { HistoryPage } from "./pages/HistoryPage";
import { WeilanPage } from "./pages/WeilanPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";
import { WorkshopPage } from "./pages/WorkshopPage";
import { DiaryPage } from "./pages/DiaryPage";
import { DrawerPage } from "./pages/DrawerPage";
import { PhotoFramePage } from "./pages/PhotoFramePage";

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
              <Route path="/home/diary" element={<DiaryPage />} />
              <Route path="/home/drawer" element={<DrawerPage />} />
              <Route path="/home/photos" element={<PhotoFramePage />} />
              <Route path="/plaza" element={<PlazaPage />} />
              <Route path="/park" element={<ParkPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/work/:workId" element={<WorkDetailPage />} />
              <Route path="/library/club/:clubId" element={<BookClubDetailPage />} />
              <Route path="/residents" element={<ResidentsPage />} />
              <Route path="/resident/:agentId" element={<ResidentPage />} />
              <Route path="/workshop" element={<WorkshopPage />} />
              <Route path="/museum" element={<MuseumPage />} />
              <Route path="/weilan" element={<WeilanPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/adult" element={<AdultPage />} />
              <Route path="/health" element={<HealthCenterPage />} />
              <Route path="/mailbox" element={<MailboxPage />} />
              <Route path="/skin-store" element={<SkinStorePage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
