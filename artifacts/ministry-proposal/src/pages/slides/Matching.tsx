export default function Matching() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Platform
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          Matching ranks candidates by skills, experience, and verified talent signals
        </h2>

        <div className="mt-[5vh] max-w-[80vw]">
          <div className="flex h-[7vh] w-full overflow-hidden rounded-[0.5vw]">
            <div className="flex w-[65%] items-center justify-center bg-primary">
              <span className="font-mono text-[1.4vw] text-white">65%</span>
            </div>
            <div className="flex w-[15%] items-center justify-center bg-[#c5cdc9]">
              <span className="font-mono text-[1.4vw] text-text">15%</span>
            </div>
            <div className="flex w-[20%] items-center justify-center bg-[#8c9893]">
              <span className="font-mono text-[1.4vw] text-white">20%</span>
            </div>
          </div>
          <div className="mt-[1.4vh] flex w-full">
            <p className="w-[65%] text-[1.3vw] text-muted">Skill coverage</p>
            <p className="w-[15%] text-[1.3vw] text-muted">Experience</p>
            <p className="w-[20%] text-[1.3vw] text-muted">Talent score</p>
          </div>
          <p className="mt-[1.8vh] font-mono text-[1.2vw] text-muted opacity-70">
            Source: Jumerra matching model
          </p>
        </div>

        <ul className="mt-[5vh] space-y-[2.4vh] max-w-[82vw]">
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.9vw] leading-[1.4] text-text text-pretty">
              Institution endorsements and verified affiliations strengthen a candidate's standing.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.9vw] leading-[1.4] text-text text-pretty">
              Verification, including institution sign-off, raises trust on both sides of the market.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.9vw] leading-[1.4] text-text text-pretty">
              The model is explainable by design — no opaque black box for a public system.
            </span>
          </li>
        </ul>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">05 / 12</p>
      </div>
    </div>
  );
}
