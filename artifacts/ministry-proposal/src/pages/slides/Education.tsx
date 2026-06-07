export default function Education() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Ministry of Education
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          The Ministry of Education gains real-time visibility into student placement
        </h2>

        <ul className="mt-[4.5vh] space-y-[2.6vh] max-w-[82vw]">
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Bulk verification of student affiliations, with faculty and department scoping.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Placement and outcome tracking across cohorts, not annual surveys.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Employer engagement and leaderboard views per institution.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Branded public institution profiles that showcase graduate strength.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Turns placement reporting from a yearly guess into a live dashboard.
            </span>
          </li>
        </ul>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">07 / 12</p>
      </div>
    </div>
  );
}
