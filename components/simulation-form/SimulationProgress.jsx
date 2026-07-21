export default function SimulationProgress({ currentStep, totalSteps }) {
  const progress = totalSteps ? Math.round((currentStep / totalSteps) * 100) : 0;

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-4 text-sm font-black text-navy">
        <span>Etapa {currentStep} de {totalSteps}</span>
        <span>{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#0D3B66] to-[#2F80ED] transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
