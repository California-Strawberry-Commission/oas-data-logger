import LoginModal from "@/components/login-modal";
import MainContent from "@/components/main-content";
import AccountButton from "@/components/top-bar/account-button";
import AdminButton from "@/components/top-bar/admin-button";
import { getCurrentUser } from "@/lib/auth";
import Image from "next/image";

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
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center">
            <Image src="/logo.png" alt="Logo" width={44} height={44} priority />
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && <AdminButton />}
            <AccountButton email={user.email} />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex flex-col md:flex-row md:flex-1 md:min-h-0">
        <MainContent />
      </main>
    </div>
  );
}
