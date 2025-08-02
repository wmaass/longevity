// components/ProgressBar.js
export default function ProgressBar({ currentPGS, percent }) {
  const hasProgress = typeof percent === 'number' && !isNaN(percent);

  return (
    <div className="mt-4">
      <div className="text-sm text-gray-700 mb-1">
        {currentPGS && hasProgress
          ? `📁 ${currentPGS} – ${percent.toFixed(1)} %`
          : '⏳ Fortschritt wird ermittelt…'}
      </div>
      <div className="w-full h-4 bg-gray-200 rounded overflow-hidden">
        <div
          className="h-4 bg-blue-500 rounded transition-all duration-300 ease-in-out"
          style={{ width: `${hasProgress ? percent : 0}%` }}
        ></div>
      </div>
    </div>
  );
}
