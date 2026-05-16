import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMessageTemplates,
  useCreateMessageTemplate,
  useDeleteMessageTemplate,
  getListMessageTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, FileText } from "lucide-react";

export default function MessageTemplatesPage() {
  const { sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();
  const { data: templates, isLoading } = useListMessageTemplates(employerId, {
    query: {
      enabled: employerId > 0,
      queryKey: getListMessageTemplatesQueryKey(employerId),
    },
  });
  const create = useCreateMessageTemplate();
  const remove = useDeleteMessageTemplate();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: getListMessageTemplatesQueryKey(employerId),
    });

  const onCreate = () => {
    if (!name.trim() || !body.trim()) {
      toast.error("Name and body are required");
      return;
    }
    create.mutate(
      { id: employerId, data: { name: name.trim(), subject, body } },
      {
        onSuccess: () => {
          toast.success("Template saved");
          invalidate();
          setOpen(false);
          setName("");
          setSubject("");
          setBody("");
        },
        onError: () => toast.error("Could not save template"),
      },
    );
  };

  const onDelete = (templateId: number) => {
    if (!confirm("Delete this template?")) return;
    remove.mutate(
      { id: employerId, templateId },
      {
        onSuccess: () => {
          toast.success("Template deleted");
          invalidate();
        },
        onError: () => toast.error("Could not delete template"),
      },
    );
  };

  return (
    <div className="container px-4 py-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Message Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Reusable outreach copy. Use{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {`{{firstName}}`}
            </code>
            ,{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {`{{employerName}}`}
            </code>
            ,{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {`{{jobTitle}}`}
            </code>{" "}
            to personalize.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-template">
              <Plus className="w-4 h-4 mr-2" /> New template
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create message template</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Initial intro"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Subject</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-template-subject"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Body</label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder={`Hi {{firstName}}, we're hiring for {{jobTitle}} at {{employerName}}…`}
                  data-testid="input-template-body"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={onCreate}
                disabled={create.isPending}
                data-testid="button-create-template"
              >
                Save template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card className="h-48 animate-pulse bg-muted/50" />
      ) : templates && templates.length > 0 ? (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{t.name}</h3>
                    {t.subject ? (
                      <p className="text-sm text-muted-foreground mt-1">
                        Subject: {t.subject}
                      </p>
                    ) : null}
                    <p className="text-sm whitespace-pre-wrap mt-2 line-clamp-4">
                      {t.body}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(t.id)}
                    aria-label="Delete template"
                    data-testid={`button-delete-template-${t.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No templates yet</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
