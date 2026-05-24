import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type FormRow } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { NewFormDialog } from "./new-form-dialog";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Layout already gates auth + allowlist; we re-derive the caller here to
  // scope the form list to forms this admin owns.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("forms")
    .select("*")
    .eq("owner_id", user!.id)
    .order("updated_at", { ascending: false })
    .range(0, 199);

  if (error) {
    return (
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold">Forms</h1>
        <p className="text-destructive text-sm">讀取失敗，請稍後再試。</p>
      </div>
    );
  }

  const forms = (data ?? []) as FormRow[];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Forms</h1>
        <NewFormDialog />
      </div>

      {forms.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          還沒有表單。點右上 New form 開一張。
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>部門</TableHead>
              <TableHead>企業 / 單位</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>階段</TableHead>
              <TableHead>通行碼</TableHead>
              <TableHead>建立</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {forms.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.department}</TableCell>
                <TableCell className="text-muted-foreground">
                  {f.organization}
                  {f.unit ? ` / ${f.unit}` : ""}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={f.status === "open" ? "default" : "secondary"}
                  >
                    {f.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{f.current_phase}</Badge>
                </TableCell>
                <TableCell className="font-mono">{f.access_code}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(f.created_at).toLocaleString("zh-TW", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/dashboard/${f.id}`}
                    className="text-sm underline"
                  >
                    view →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
