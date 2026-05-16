import { useState } from "react";
import { Link } from "wouter";
import {
  useListMyOffers,
  useAcceptReverseOffer,
  useDeclineReverseOffer,
  useCounterReverseOffer,
  getListMyOffersQueryKey,
  listMyOffers,
  type ReverseOffer,
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
import { Inbox, Building2, CheckCircle2, XCircle, ArrowLeftRight, Clock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

function formatRange(min: number, max: number, currency: string) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${currency} ${fmt(min)} – ${fmt(max)}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "accepted":
      return <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Accepted</Badge>;
    case "declined":
      return <Badge variant="outline" className="text-muted-foreground"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
    case "countered":
      return <Badge variant="outline"><ArrowLeftRight className="w-3 h-3 mr-1" />Countered</Badge>;
    case "expired":
      return <Badge variant="outline" className="text-muted-foreground">Expired</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function CounterDialog({ offer }: { offer: ReverseOffer }) {
  const [open, setOpen] = useState(false);
  const [salaryMin, setSalaryMin] = useState(String(offer.salaryMax));
  const [salaryMax, setSalaryMax] = useState(String(Math.round(offer.salaryMax * 1.15)));
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const counter = useCounterReverseOffer();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-counter-${offer.id}`}>
          <ArrowLeftRight className="w-4 h-4 mr-1.5" /> Counter
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a counter offer</DialogTitle>
          <DialogDescription>
            One counter is allowed. The employer will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cmin">Salary min ({offer.currency})</Label>
              <Input id="cmin" inputMode="numeric" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmax">Salary max ({offer.currency})</Label>
              <Input id="cmax" inputMode="numeric" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnote">Note (optional)</Label>
            <Textarea id="cnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this number works for me…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={counter.isPending}
            onClick={async () => {
              const min = Number(salaryMin);
              const max = Number(salaryMax);
              if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
                toast.error("Salary max must be at least salary min");
                return;
              }
              try {
                await counter.mutateAsync({
                  id: offer.id,
                  data: {
                    jobTitle: offer.jobTitle,
                    salaryMin: min,
                    salaryMax: max,
                    currency: offer.currency,
                    note,
                  },
                });
                await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                toast.success("Counter sent");
                setOpen(false);
              } catch (err: any) {
                toast.error(err?.data?.error ?? "Could not send counter");
              }
            }}
          >
            Send counter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OffersInboxPage() {
  const { sessionUser } = useAuth();
  const isCandidate = sessionUser?.role === "candidate";
  const { data: offers, isLoading } = useListMyOffers({
    query: {
      queryKey: getListMyOffersQueryKey(),
      queryFn: () => listMyOffers(),
      enabled: isCandidate,
    },
  });
  const accept = useAcceptReverseOffer();
  const decline = useDeclineReverseOffer();
  const qc = useQueryClient();

  if (sessionUser && !isCandidate) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">Candidates only</p>
            <p className="text-sm text-muted-foreground mt-1">
              Reverse offers are sent to candidates. Sign in with a candidate account to view your inbox.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <div className="container max-w-3xl py-12 px-4"><div className="animate-pulse h-[400px] bg-muted rounded-2xl" /></div>;
  }

  return (
    <div className="container max-w-3xl py-10 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Inbox className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reverse offers</h1>
          <p className="text-sm text-muted-foreground">
            Employers bid for your time while your window is open. Accept to reveal your identity and create an application; counter once if the numbers don't fit.
          </p>
        </div>
      </div>

      {(!offers || offers.length === 0) ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No offers yet</p>
            <p className="text-sm mt-1">Open your window on your <Link href="/account/profile" className="text-primary hover:underline">profile</Link> to start receiving bids.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {offers.map((offer) => (
            <Card key={offer.id} className="shadow-sm" data-testid={`card-offer-${offer.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      {offer.employerLogoUrl ? (
                        <img src={offer.employerLogoUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <Building2 className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{offer.jobTitle}</CardTitle>
                      <CardDescription>{offer.employerName ?? "Employer"}</CardDescription>
                    </div>
                  </div>
                  {statusBadge(offer.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Salary</p>
                    <p className="font-semibold">{formatRange(offer.salaryMin, offer.salaryMax, offer.currency)}</p>
                  </div>
                  {offer.startDate && (
                    <div>
                      <p className="text-muted-foreground text-xs">Start date</p>
                      <p className="font-semibold">{new Date(offer.startDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground text-xs">Received</p>
                    <p className="font-semibold">{new Date(offer.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                {offer.note && (
                  <p className="text-sm text-muted-foreground border-l-2 pl-3 italic">{offer.note}</p>
                )}
                {offer.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      data-testid={`button-accept-${offer.id}`}
                      disabled={accept.isPending}
                      onClick={async () => {
                        try {
                          await accept.mutateAsync({ id: offer.id });
                          await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                          toast.success("Offer accepted. The employer can now see your profile.");
                        } catch (err: any) {
                          toast.error(err?.data?.error ?? "Could not accept");
                        }
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" /> Accept
                    </Button>
                    {!offer.parentOfferId && <CounterDialog offer={offer} />}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`button-decline-${offer.id}`}
                      disabled={decline.isPending}
                      onClick={async () => {
                        try {
                          await decline.mutateAsync({ id: offer.id });
                          await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                          toast.success("Offer declined");
                        } catch (err: any) {
                          toast.error(err?.data?.error ?? "Could not decline");
                        }
                      }}
                    >
                      <XCircle className="w-4 h-4 mr-1.5" /> Decline
                    </Button>
                  </div>
                )}
                {offer.status === "accepted" && offer.applicationId && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/account/applications/${offer.applicationId}`}>View application</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
