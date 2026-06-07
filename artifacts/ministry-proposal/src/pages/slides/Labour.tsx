export default function Labour() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Ministry of Labour
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          The Ministry of Labour gains live labour-market intelligence
        </h2>

        <ul className="mt-[4.5vh] space-y-[2.6vh] max-w-[82vw]">
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Market overview of hiring activity across sectors and roles.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Skills demand-and-supply signals drawn from real applications and postings.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Salary and compensation insights to inform policy and wage guidance.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Aggregate-only dashboards — individual records are never exposed at the ministry layer.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Replaces lagging statistics with a continuously updated view of the market.
            </span>
          </li>
        </ul>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">08 / 12</p>
      </div>
    </div>
  );
}
