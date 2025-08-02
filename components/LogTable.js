import { useState, useEffect } from 'react';

export default function LogTable({ logStream }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!logStream) return;

    const handler = (e) => {
      if (e.data?.log) {
        setLogs(prev => [...prev, { time: new Date(), message: e.data.log }]);
      }
    };

    logStream.addEventListener('message', handler);
    return () => logStream.removeEventListener('message', handler);
  }, [logStream]);

  return (
    <div className="mt-4 overflow-auto border rounded max-h-80">
      <table className="min-w-full text-sm table-auto">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-2 py-1 text-left">Zeit</th>
            <th className="px-2 py-1 text-left">Meldung</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, idx) => (
            <tr key={idx} className="border-t">
              <td className="px-2 py-1 text-xs text-gray-500">
                {log.time.toLocaleTimeString()}
              </td>
              <td className="px-2 py-1 font-mono whitespace-pre-wrap">{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
