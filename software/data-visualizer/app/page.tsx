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
    <main className="flex flex-col h-full items-center p-4 gap-4">
      <header className="w-full flex justify-end gap-4">
        {isAdmin && <AdminButton />}
        <LogoutButton />
      </header>

      <DataSelector />
    </main>
  );
}
