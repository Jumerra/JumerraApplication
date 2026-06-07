export default function Ask() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.8vh] bg-primary" />
      <div className="absolute bottom-0 left-0 right-0 h-[0.8vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          The Ask
        </p>
        <h2 className="font-display font-bold text-[2.6vw] leading-[1.12] tracking-tight max-w-[82vw] text-balance">
          The ask: endorse, onboard, and pilot Jumerra
        </h2>

        <div className="mt-[5vh] space-y-[2.8vh] max-w-[84vw]">
          <p className="text-[1.85vw] leading-[1.4] text-text text-pretty">
            <span className="font-bold text-accent">Ministry of Technology</span>
            {" "}— adopt and publicly endorse Jumerra as national talent infrastructure.
          </p>
          <p className="text-[1.85vw] leading-[1.4] text-text text-pretty">
            <span className="font-bold text-accent">Ministry of Education</span>
            {" "}— commit pilot institutions for placement tracking and verification.
          </p>
          <p className="text-[1.85vw] leading-[1.4] text-text text-pretty">
            <span className="font-bold text-accent">Ministry of Labour</span>
            {" "}— nominate analysts to activate labour-market dashboards.
          </p>
        </div>

        <p className="mt-[3.4vh] text-[1.7vw] text-muted max-w-[80vw]">
          Together — launch a time-boxed pilot, then review for national rollout.
        </p>

        <div className="mt-[5vh] h-[0.35vh] w-[16vw] bg-primary" />

        <p className="mt-[4vh] font-display font-bold text-[2.4vw] leading-[1.2] text-accent max-w-[80vw] text-balance">
          Jumerra — connecting study to work, with the data government needs.
        </p>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">12 / 12</p>
      </div>
    </div>
  );
}
