import { HeaderDashboard } from "@/components/layout/header-dashboard";
import { Footer } from "@/components/layout/footer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <HeaderDashboard />
      <main className="flex-1 w-full">{children}</main>
      <Footer />
    </>
  );
}