import AdminButton from "@/components/admin-button";
import DataSelector from "@/components/data-selector";
import LoginModal from "@/components/login-modal";
import LogoutButton from "@/components/logout-button";
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
    <div className="flex flex-col min-h-screen">
      {/* Top app bar */}
      <header className="w-full border-b bg-background">
        <div className="max-w-7xl mx-auto flex items-center justify-end gap-2 h-14 px-4">
          {isAdmin && <AdminButton />}
          <LogoutButton email={user.email} />
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 flex flex-col items-center p-6 gap-6">
        <div className="w-full max-w-4xl">
          <DataSelector />
        </div>
      </main>
    </div>
  );
}
