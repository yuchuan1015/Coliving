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
import { GuidePage } from "./pages/GuidePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResidentDirectory, ResidentCardPage } from "./pages/ResidentDirectory";
import { SchedulesPage } from "./pages/SchedulesPage";
import { DiaryPage } from "./pages/DiaryPage";
import { DrawerPage } from "./pages/DrawerPage";
import { PhotoFramePage } from "./pages/PhotoFramePage";
import { MailboxPage } from "./pages/MailboxPage";
import { BookshelfPage } from "./pages/BookshelfPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReadingShelfPage } from "./pages/ReadingShelfPage";
import { ReadingPage } from "./pages/ReadingPage";
import { AccountSettingsPage } from "./pages/AccountSettingsPage";
import { MailField, ParkField } from "./fields/EverydayFields";
import { AIChatField } from "./fields/AIChatField";
import { ArticlesField, HistoryField, LibraryField, MuseumField } from "./fields/ContentFields";
import { WorkshopField, WeilanField } from "./fields/ActivityFields";
import { PlazaField } from "./fields/PlazaField";
import { AuthorizePage } from "./pages/AuthorizePage";
import { DMReportsPage } from "./pages/DMReportsPage";
import { ContentReviewsPage } from "./pages/ContentReviewsPage";
import "./social.css";
import { LanguageDocument } from "./i18n/LanguageControl";

export default function App() {
  return (
    <AuthProvider>
      <LanguageDocument />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/authorize" element={<AuthorizePage />} />
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/guide" element={<GuidePage />} />
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
              <Route path="/admin/dm-reports" element={<DMReportsPage />} />
              <Route path="/admin/content-reviews" element={<ContentReviewsPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/plaza" element={<PlazaField />} />
              <Route path="/settings" element={<AccountSettingsPage />} />
              <Route path="/ai-chat" element={<AIChatField />} />
              <Route path="/mail" element={<MailField />} />
              <Route path="/park" element={<ParkField />} />
              <Route path="/library" element={<LibraryField />} />
              <Route path="/museum" element={<MuseumField />} />
              <Route path="/history" element={<HistoryField />} />
              <Route path="/health" element={<ArticlesField key="health" kind="health" />} />
              <Route path="/adult" element={<ArticlesField key="adult" kind="adult" />} />
              <Route path="/workshop" element={<WorkshopField />} />
              <Route path="/weilan" element={<WeilanField />} />
              <Route path="/residents" element={<ResidentDirectory />} />
              <Route path="/resident/:agentId" element={<ResidentCardPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
