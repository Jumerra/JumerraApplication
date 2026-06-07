export default function Platform() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Platform
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          Jumerra is an operational three-sided platform with a dedicated government layer
        </h2>

        <div className="mt-[5vh] space-y-[3vh] max-w-[85vw]">
          <div className="grid grid-cols-[20vw_1fr] gap-[2.5vw] items-baseline">
            <p className="font-display font-bold text-[1.85vw] text-accent">Candidates</p>
            <p className="text-[1.85vw] leading-[1.35] text-text text-pretty">
              Profile and CV tools, applications, and AI-assisted career guidance.
            </p>
          </div>
          <div className="grid grid-cols-[20vw_1fr] gap-[2.5vw] items-baseline">
            <p className="font-display font-bold text-[1.85vw] text-accent">Employers</p>
            <p className="text-[1.85vw] leading-[1.35] text-text text-pretty">
              Tiered job posting, talent pools, applicant pipeline, and offers.
            </p>
          </div>
          <div className="grid grid-cols-[20vw_1fr] gap-[2.5vw] items-baseline">
            <p className="font-display font-bold text-[1.85vw] text-accent">Institutions</p>
            <p className="text-[1.85vw] leading-[1.35] text-text text-pretty">
              Verify student affiliations, manage faculties and departments, track outcomes.
            </p>
          </div>
          <div className="grid grid-cols-[20vw_1fr] gap-[2.5vw] items-baseline">
            <p className="font-display font-bold text-[1.85vw] text-accent">Government layer</p>
            <p className="text-[1.85vw] leading-[1.35] text-text text-pretty">
              Role-scoped ministry dashboards built on the same live data.
            </p>
          </div>
        </div>

        <p className="mt-[5vh] text-[1.85vw] font-semibold text-text max-w-[82vw]">
          Already built and running across web, mobile, and a shared API — not a concept.
        </p>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">04 / 12</p>
      </div>
    </div>
  );
}
