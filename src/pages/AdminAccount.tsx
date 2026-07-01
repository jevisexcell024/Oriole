import { AdminShell } from "@/components/AdminShell";
import { AccountSettings } from "@/components/AccountSettings";

export function AdminAccount() {
  return (
    <AdminShell>
      <AccountSettings />
    </AdminShell>
  );
}
