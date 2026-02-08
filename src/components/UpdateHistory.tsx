import type { UpdateEntry } from '../types';

interface UpdateHistoryProps {
  updates: UpdateEntry[];
}

export function UpdateHistory({ updates }: UpdateHistoryProps) {
  return (
    <div className="section">
      <h2>Update History</h2>
      <div className="timeline">
        {updates.length === 0 ? (
          <p style={{ color: '#999' }}>No updates yet</p>
        ) : (
          updates.map((update, i) => {
            const dateStr = update.timestamp.toLocaleDateString() + ' ' + update.timestamp.toLocaleTimeString();
            const change = update.newValue - update.oldValue;
            const changeStr = change > 0 ? `+${change}` : String(change);

            return (
              <div className="timeline-item" key={i}>
                <div className="timeline-header">
                  <div>
                    <span className="timeline-metric">{update.metricName}</span>
                    <span className="timeline-change">
                      {update.oldValue} → {update.newValue} ({changeStr})
                    </span>
                  </div>
                  <div className="timeline-date">{dateStr}</div>
                </div>
                <div className="timeline-description">{update.description}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
