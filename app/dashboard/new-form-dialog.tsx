"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { createForm } from "./actions";

export function NewFormDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogTrigger render={<Button>New form</Button>} />
      <DialogContent>
        <form action={createForm}>
          <DialogHeader>
            <DialogTitle>新增表單</DialogTitle>
            <DialogDescription>
              一張表 = 一個部門代表。通行碼會自動產生。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="organization">企業 *</Label>
              <Input id="organization" name="organization" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unit">單位（optional）</Label>
              <Input id="unit" name="unit" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="department">部門 *</Label>
              <Input id="department" name="department" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="department_brief">部門簡述（optional）</Label>
              <Textarea
                id="department_brief"
                name="department_brief"
                rows={3}
                placeholder="這部門大概在做什麼、為什麼想做 AI 評估"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">建立</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
