export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Context
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          Early-career hiring is fragmented across candidates, employers, and institutions
        </h2>

        <ul className="mt-[4.5vh] space-y-[2.6vh] max-w-[82vw]">
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Graduates and interns lack a structured, trusted pathway from study to first job.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Employers struggle to find and verify entry-level talent efficiently.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Institutions have limited visibility into where their students actually land.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Government lacks a single, real-time view of skills supply and hiring demand.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              These gaps sit across three mandates today — none owns the connective infrastructure.
            </span>
          </li>
        </ul>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">03 / 12</p>
      </div>
    </div>
  );
}
