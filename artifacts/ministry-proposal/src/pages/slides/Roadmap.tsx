export default function Roadmap() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Roadmap
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          Adoption proceeds in four phases, from pilot to national rollout
        </h2>

        <div className="relative mt-[8vh]">
          <div className="absolute left-[1.5vw] right-[1.5vw] top-[1.6vw] h-[0.25vh] bg-border" />

          <div className="relative grid grid-cols-4 gap-[2.5vw]">
            <div className="flex flex-col items-start">
              <div className="flex h-[3.2vw] w-[3.2vw] items-center justify-center rounded-full bg-primary">
                <span className="font-mono text-[1.4vw] text-white">1</span>
              </div>
              <p className="font-mono text-[1.25vw] tracking-[0.2em] uppercase text-muted mt-[2.6vh]">
                Phase 1
              </p>
              <p className="font-display font-bold text-[1.6vw] text-text mt-[0.9vh] leading-[1.2]">
                Adopt and endorse
              </p>
              <p className="text-[1.5vw] text-muted mt-[1.3vh] leading-[1.35]">
                Ministry of Technology establishes platform governance.
              </p>
            </div>

            <div className="flex flex-col items-start">
              <div className="flex h-[3.2vw] w-[3.2vw] items-center justify-center rounded-full bg-primary">
                <span className="font-mono text-[1.4vw] text-white">2</span>
              </div>
              <p className="font-mono text-[1.25vw] tracking-[0.2em] uppercase text-muted mt-[2.6vh]">
                Phase 2
              </p>
              <p className="font-display font-bold text-[1.6vw] text-text mt-[0.9vh] leading-[1.2]">
                Onboard institutions
              </p>
              <p className="text-[1.5vw] text-muted mt-[1.3vh] leading-[1.35]">
                Pilot institutions join under the Ministry of Education.
              </p>
            </div>

            <div className="flex flex-col items-start">
              <div className="flex h-[3.2vw] w-[3.2vw] items-center justify-center rounded-full bg-primary">
                <span className="font-mono text-[1.4vw] text-white">3</span>
              </div>
              <p className="font-mono text-[1.25vw] tracking-[0.2em] uppercase text-muted mt-[2.6vh]">
                Phase 3
              </p>
              <p className="font-display font-bold text-[1.6vw] text-text mt-[0.9vh] leading-[1.2]">
                Activate analytics
              </p>
              <p className="text-[1.5vw] text-muted mt-[1.3vh] leading-[1.35]">
                Ministry of Labour dashboards run on accumulated data.
              </p>
            </div>

            <div className="flex flex-col items-start">
              <div className="flex h-[3.2vw] w-[3.2vw] items-center justify-center rounded-full bg-primary">
                <span className="font-mono text-[1.4vw] text-white">4</span>
              </div>
              <p className="font-mono text-[1.25vw] tracking-[0.2em] uppercase text-muted mt-[2.6vh]">
                Phase 4
              </p>
              <p className="font-display font-bold text-[1.6vw] text-text mt-[0.9vh] leading-[1.2]">
                National rollout
              </p>
              <p className="text-[1.5vw] text-muted mt-[1.3vh] leading-[1.35]">
                Scale across institutions, employers, and regions.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-[9vh] text-[1.7vw] font-semibold text-text max-w-[82vw]">
          Each phase is independently useful — value starts in Phase 1, not at the end.
        </p>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">11 / 12</p>
      </div>
    </div>
  );
}
