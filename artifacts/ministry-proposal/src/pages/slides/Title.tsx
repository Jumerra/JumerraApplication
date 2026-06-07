export default function Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.8vh] bg-primary" />

      <div className="absolute inset-0 flex flex-col justify-center px-[8vw]">
        <p className="font-mono text-primary text-[1.3vw] tracking-[0.32em] uppercase mb-[4.5vh]">
          Ministry Adoption Proposal
        </p>

        <h1 className="font-display font-bold text-[6vw] leading-[1] tracking-tight">
          Jumerra
        </h1>

        <p className="font-display font-semibold text-[2.7vw] leading-[1.18] mt-[2.4vh] max-w-[68vw] text-balance">
          National talent infrastructure for early-career employment
        </p>

        <div className="mt-[6vh] h-[0.35vh] w-[15vw] bg-primary" />

        <div className="mt-[5vh] space-y-[1.6vh]">
          <p className="text-[1.8vw] text-text">
            Prepared for the Ministry of Technology
          </p>
          <p className="text-[1.8vw] text-muted">
            In partnership with the Ministries of Education and Labour
          </p>
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[8vw] right-[8vw] flex justify-between items-end">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.2em] uppercase">
          Jumerra
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.2em]">
          June 2026
        </p>
      </div>
    </div>
  );
}
