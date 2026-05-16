import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTalentPool,
  useRemoveTalentPoolMember,
  useListMessageTemplates,
  useSendOutreach,
  getGetTalentPoolQueryKey,
  getListMessageTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Send, Star, X } from "lucide-react";

export default function TalentPoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const poolId = Number(params.poolId);
  const { sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();

  const { data: pool, isLoading } = useGetTalentPool(employerId, poolId, {
    query: {
      enabled: employerId > 0 && poolId > 0,
      queryKey: getGetTalentPoolQueryKey(employerId, poolId),
    },
  });
  const { data: templates } = useListMessageTemplates(employerId, {
    query: {
      enabled: employerId > 0,
      queryKey: getListMessageTemplatesQueryKey(employerId),
    },
  });
  const removeMember = useRemoveTalentPoolMember();
  const sendOutreach = useSendOutreach();

  const [outreachOpen, setOutreachOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: getGetTalentPoolQueryKey(employerId, poolId),
    });

  const onRemove = (candidateId: number) => {
    removeMember.mutate(
      { id: employerId, poolId, candidateId },
      {
        onSuccess: () => {
          toast.success("Removed from pool");
          invalidate();
        },
        onError: () => toast.error("Could not remove member"),
      },
    );
  };

  const onPickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => String(x.id) === id);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  };

  const onSend = () => {
    if (!body.trim()) {
      toast.error("Message body is required");
      return;
    }
    sendOutreach.mutate(
      {
        id: employerId,
        data: {
          poolId,
          subject: subject || undefined,
          body,
          templateId: templateId ? Number(templateId) : undefined,
        },
      },
      {
        onSuccess: (resp) => {
          toast.success(
            `Sent ${resp.sent} message${resp.sent === 1 ? "" : "s"}` +
              (resp.skipped > 0 ? ` (${resp.skipped} skipped)` : ""),
          );
          setOutreachOpen(false);
          setSubject("");
          setBody("");
          setTemplateId("");
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? "Could not send messages";
          toast.error(msg);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="container py-12 px-4">
        <div className="animate-pulse h-96 bg-muted rounded-2xl" />
      </div>
    );
  }
  if (!pool) {
    return (
      <div className="container py-20 text-center text-muted-foreground">
        Pool not found.
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/employer/talent-pools"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> All pools
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{pool.name}</h1>
          {pool.description ? (
            <p className="text-muted-foreground mt-1">{pool.description}</p>
          ) : null}
          <p className="text-sm text-muted-foreground mt-2">
            {pool.memberCount} members
          </p>
        </div>
        <Dialog open={outreachOpen} onOpenChange={setOutreachOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-bulk-outreach">
              <Send className="w-4 h-4 mr-2" /> Send outreach
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Send outreach to pool</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {templates && templates.length > 0 ? (
                <div>
                  <label className="text-sm font-medium">
                    Template (optional)
                  </label>
                  <Select value={templateId} onValueChange={onPickTemplate}>
                    <SelectTrigger data-testid="select-template">
                      <SelectValue placeholder="Pick a template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div>
                <label className="text-sm font-medium">Subject</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  data-testid="input-outreach-subject"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Body</label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder={`Hi {{firstName}}, ...`}
                  data-testid="input-outreach-body"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Supports <code>{`{{firstName}}`}</code>{" "}
                  <code>{`{{employerName}}`}</code>{" "}
                  <code>{`{{jobTitle}}`}</code>.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={onSend}
                disabled={sendOutreach.isPending}
                data-testid="button-send-outreach"
              >
                Send to {pool.memberCount} candidate
                {pool.memberCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {pool.members.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No members yet. Add candidates from the talent directory.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pool.members.map((m) => (
            <Card key={m.candidateId}>
              <CardContent className="p-4 flex items-center gap-4">
                <img
                  src={m.candidateAvatarUrl}
                  alt={m.candidateName}
                  className="w-12 h-12 rounded-full bg-muted object-cover"
                />
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/candidates/${m.candidateId}`}
                    className="font-semibold hover:underline truncate block"
                  >
                    {m.candidateName}
                  </Link>
                  <p className="text-sm text-muted-foreground truncate">
                    {m.headline}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge
                      variant="outline"
                      className="text-xs gap-1 font-normal"
                    >
                      <MapPin className="w-3 h-3" />
                      {m.location}
                    </Badge>
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Star className="w-3 h-3 fill-primary text-primary" />
                      {m.talentScore}
                    </Badge>
                    {m.openToOffers ? (
                      <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">
                        Open to offers
                      </Badge>
                    ) : null}
                    {m.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-xs font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(m.candidateId)}
                  aria-label="Remove from pool"
                  data-testid={`button-remove-member-${m.candidateId}`}
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
