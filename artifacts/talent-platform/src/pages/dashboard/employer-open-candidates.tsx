import { useState } from "react";
import {
  useListOpenCandidates,
  usePostReverseOffer,
  useListMySentOffers,
  useAcceptReverseOfferCounter,
  useDeclineReverseOfferCounter,
  getListMySentOffersQueryKey,
  type OpenCandidateCard,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Send, Sparkles, GraduationCap, MapPin, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

function timeLeft(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return "Closed";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function OfferDialog({ card }: { card: OpenCandidateCard }) {
  const [open, setOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [startDate, setStartDate] = useState("");
  const [note, setNote] = useState("");
  const post = usePostReverseOffer();
  const qc = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-offer-${card.id}`}>
          <Send className="w-4 h-4 mr-1.5" /> Send offer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a reverse offer</DialogTitle>
          <DialogDescription>
            Candidate: <span className="font-medium">{card.headline}</span>
            {card.institutionName && ` · ${card.institutionName}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Role title</Label>
            <Input id="title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Junior Backend Engineer" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur">Currency</Label>
              <Input id="cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={4} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smin">Salary min</Label>
              <Input id="smin" inputMode="numeric" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smax">Salary max</Label>
              <Input id="smax" inputMode="numeric" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start">Start date (optional)</Label>
            <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Pitch / note (optional)</Label>
            <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What makes this opportunity a great fit…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={post.isPending}
            onClick={async () => {
              const min = Number(salaryMin);
              const max = Number(salaryMax);
              if (jobTitle.trim().length < 2) {
                toast.error("Add a role title");
                return;
              }
              if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
                toast.error("Salary max must be ≥ salary min");
                return;
              }
              try {
                await post.mutateAsync({
                  windowId: card.id,
                  data: {
                    jobTitle: jobTitle.trim(),
                    salaryMin: min,
                    salaryMax: max,
                    currency: currency || "USD",
                    startDate: startDate || undefined,
                    note: note || undefined,
                  },
                });
                await qc.invalidateQueries({ queryKey: getListMySentOffersQueryKey() });
                toast.success("Offer sent");
                setOpen(false);
                setJobTitle(""); setSalaryMin(""); setSalaryMax(""); setStartDate(""); setNote("");
              } catch (err: any) {
                toast.error(err?.data?.error ?? "Could not send offer");
              }
            }}
          >
            Send offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployerOpenCandidatesPage() {
  const [skill, setSkill] = useState("");
  const [showSent, setShowSent] = useState(false);
  const { data: rows, isLoading } = useListOpenCandidates(skill ? { skill } : undefined);
  const { data: sent } = useListMySentOffers();
  const qc = useQueryClient();
  const acceptCounter = useAcceptReverseOfferCounter();
  const declineCounter = useDeclineReverseOfferCounter();

  async function handleCounter(id: number, accept: boolean) {
    try {
      if (accept) await acceptCounter.mutateAsync({ id });
      else await declineCounter.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListMySentOffersQueryKey() });
      toast.success(accept ? "Counter accepted" : "Counter declined");
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not respond to counter");
    }
  }

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Open candidates</h1>
          <p className="text-sm text-muted-foreground">Candidates with active auction windows. Identities reveal only when they accept your offer.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label htmlFor="skill">Filter by skill</Label>
            <Input id="skill" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="e.g. React" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="animate-pulse h-[300px] bg-muted rounded-2xl" />
      ) : !rows || rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No open candidates right now</p>
            <p className="text-sm mt-1">Check back as candidates open their auction windows.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((card) => (
            <Card key={card.id} className="shadow-sm flex flex-col" data-testid={`card-open-${card.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{card.headline}</CardTitle>
                  <Badge variant="secondary" className="shrink-0"><Clock className="w-3 h-3 mr-1" />{timeLeft(card.closesAt)}</Badge>
                </div>
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  <MapPin className="w-3 h-3" /> {card.location} · {card.yearsExperience}y experience
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {card.institutionName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5" /> {card.institutionName}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Badge className="bg-primary/10 text-primary border-primary/20">Talent {card.talentScore}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {card.skills.slice(0, 6).map((s) => (
                    <Badge key={s} variant="outline" className="text-xs font-normal">{s}</Badge>
                  ))}
                  {card.skills.length > 6 && (
                    <Badge variant="outline" className="text-xs font-normal">+{card.skills.length - 6}</Badge>
                  )}
                </div>
                <div className="pt-1">
                  <OfferDialog card={card} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowSent((v) => !v)}>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Offers you've sent</CardTitle>
              <CardDescription>{sent?.length ?? 0} offer(s)</CardDescription>
            </div>
            {showSent ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardHeader>
        {showSent && (
          <CardContent className="space-y-2">
            {(!sent || sent.length === 0) ? (
              <p className="text-sm text-muted-foreground">No offers sent yet.</p>
            ) : sent.map((o) => {
              const isCandidateCounter = Boolean(o.parentOfferId) && o.status === "pending";
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border" data-testid={`row-sent-${o.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {o.jobTitle}
                      {isCandidateCounter && <span className="ml-2 text-xs font-normal text-amber-600">Counter from candidate</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.currency} {o.salaryMin.toLocaleString()}–{o.salaryMax.toLocaleString()} · {new Date(o.createdAt).toLocaleDateString()}
                      {o.status === "accepted" && o.candidateName && ` · ${o.candidateName}`}
                    </p>
                  </div>
                  {isCandidateCounter ? (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCounter(o.id, false)}
                        disabled={declineCounter.isPending || acceptCounter.isPending}
                        data-testid={`button-decline-counter-${o.id}`}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleCounter(o.id, true)}
                        disabled={acceptCounter.isPending || declineCounter.isPending}
                        data-testid={`button-accept-counter-${o.id}`}
                      >
                        Accept counter
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={o.status === "accepted" ? "default" : "outline"} className="capitalize">{o.status}</Badge>
                  )}
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
