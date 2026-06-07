export default function ExecutiveSummary() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Summary
        </p>
        <h2 className="font-display font-bold text-[2.6vw] leading-[1.12] tracking-tight">
          Executive summary
        </h2>

        <div className="mt-[5vh] space-y-[3.4vh] max-w-[84vw]">
          <div className="flex items-start gap-[2vw]">
            <span className="font-mono text-primary text-[1.5vw] pt-[0.5vh]">01</span>
            <p className="text-[2vw] leading-[1.4] text-text text-pretty">
              Jumerra is an operational platform — web, mobile, and a shared API — connecting early-career candidates, employers, and educational institutions.
            </p>
          </div>
          <div className="flex items-start gap-[2vw]">
            <span className="font-mono text-primary text-[1.5vw] pt-[0.5vh]">02</span>
            <p className="text-[2vw] leading-[1.4] text-text text-pretty">
              It already produces the data three ministries need: verified student placement, hiring activity, and labour-market signals.
            </p>
          </div>
          <div className="flex items-start gap-[2vw]">
            <span className="font-mono text-primary text-[1.5vw] pt-[0.5vh]">03</span>
            <p className="text-[2vw] leading-[1.4] text-text text-pretty">
              Each ministry plugs into a dedicated, access-controlled function — Technology governs the infrastructure, Education tracks placement, Labour reads market intelligence.
            </p>
          </div>
          <div className="flex items-start gap-[2vw]">
            <span className="font-mono text-primary text-[1.5vw] pt-[0.5vh]">04</span>
            <p className="text-[2vw] leading-[1.4] text-text text-pretty">
              The ask: Ministry of Technology adoption and endorsement, with onboarding commitments from Education and Labour, starting with a pilot.
            </p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">02 / 12</p>
      </div>
    </div>
  );
}
