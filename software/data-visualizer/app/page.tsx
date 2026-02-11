import AdminButton from "@/components/top-bar/admin-button";
import LoginModal from "@/components/login-modal";
import AccountButton from "@/components/top-bar/account-button";
import MainContent from "@/components/main-content";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  const isAdmin = user && user.role === "ADMIN";

  if (!user) {
    return (
      <main className="flex flex-col h-full items-center p-4 gap-4">
        <LoginModal />
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top app bar */}
      <header className="w-full border-b bg-background">
        <div className="max-w-7xl mx-auto flex items-center justify-end gap-2 h-14 px-4">
          {isAdmin && <AdminButton />}
          <AccountButton email={user.email} />
        </div>
      </header>

      {/* Page content */}
      <main className="flex flex-1 min-h-0">
        <MainContent />
      </main>
    </div>
  );
}
